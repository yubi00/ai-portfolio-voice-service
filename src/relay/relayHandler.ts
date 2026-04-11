import WebSocket from 'ws';
import { IncomingMessage } from 'http';
import { logger } from '../lib/logger';
import { config } from '../config';
import { knowledgeProvider, buildSystemPrompt } from '../knowledge';
import { createVoiceSession } from '../voice';

// Single responsibility: manage the relay between one browser client and one OpenAI session.

// Module-level concurrent session counter — shared across all connections.
let activeSessions = 0;

function generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isOriginAllowed(origin: string | undefined): boolean {
    const allowed = config.costGuards.allowedOrigins;
    // Empty list = dev mode, allow all origins.
    if (allowed.length === 0) return true;
    if (!origin) return false;
    return allowed.includes(origin);
}

export async function handleClientConnection(clientWs: WebSocket, req: IncomingMessage): Promise<void> {
    const origin = req.headers.origin;

    // Origin check — reject connections from unknown origins in production.
    if (!isOriginAllowed(origin)) {
        logger.warn('Rejected WS connection from disallowed origin', { origin });
        clientWs.close(1008, 'Origin not allowed');
        return;
    }

    // Concurrent session cap — reject if already at the limit.
    if (activeSessions >= config.costGuards.maxConcurrentSessions) {
        logger.warn('Rejected WS connection: concurrent session limit reached', {
            activeSessions,
            limit: config.costGuards.maxConcurrentSessions,
        });
        clientWs.close(1013, 'Server at capacity');
        return;
    }

    activeSessions++;
    const sessionId = generateSessionId();
    logger.info('Browser client connected', { sessionId, activeSessions });

    // Build persona + knowledge system prompt before opening the upstream connection.
    const systemPrompt = await buildSystemPrompt(knowledgeProvider);

    const voiceSession = createVoiceSession(
        sessionId,
        systemPrompt,
        {
            // Forward backend messages → browser (includes provider-specific error events)
            onMessage: (data) => {
                if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(data);
                }
            },
            // When the voice session closes → notify browser with reason, then close
            onClose: (reason) => {
                activeSessions = Math.max(0, activeSessions - 1);
                if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({ type: 'session.closed', reason }));
                    clientWs.close(1000, reason);
                }
            },
            // Transport/backend errors (OpenAI API errors still come via message events)
            onError: (message) => {
                if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({ type: 'relay.error', message }));
                }
            },
        },
    );

    // Forward browser messages → OpenAI, and reset the inactivity timer each time.
    // ws@8 always delivers messages as Buffer; send(Buffer) emits binary frames.
    // Preserve the original frame type: text frames must be sent as strings so
    // OpenAI receives them as text WebSocket frames (it requires text for JSON events).
    //
    // NOTE: Do NOT reset the inactivity timer on audio buffer appends — the mic
    // streams chunks continuously (even during silence), which would prevent the
    // timer from ever firing. Only reset on conversational events.
    clientWs.on('message', (data, isBinary) => {
        const raw = isBinary ? data : data.toString();
        if (!isBinary) {
            try {
                const parsed = JSON.parse(raw as string);
                if (parsed.type !== 'input_audio_buffer.append') {
                    voiceSession.resetInactivity();
                }
            } catch { /* malformed JSON — still forward, don't reset */ }
        }
        voiceSession.send(raw);
    });

    clientWs.on('close', (code, reason) => {
        activeSessions = Math.max(0, activeSessions - 1);
        logger.info('Browser client disconnected', {
            sessionId,
            code,
            reason: reason.toString(),
            activeSessions,
        });
        voiceSession.close('client_disconnect');
    });

    clientWs.on('error', (err) => {
        logger.error('Browser client WS error', { sessionId, error: err.message });
        voiceSession.close('client_error');
    });
}
