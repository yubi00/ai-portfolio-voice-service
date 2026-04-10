import WebSocket from 'ws';
import { IncomingMessage } from 'http';
import { OpenAIRealtimeSession } from './OpenAIRealtimeSession';
import { logger } from '../lib/logger';
import { config } from '../config';

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

export function handleClientConnection(clientWs: WebSocket, req: IncomingMessage): void {
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

    const openAiSession = new OpenAIRealtimeSession(
        sessionId,
        // Forward OpenAI messages → browser (includes OpenAI-level error events)
        (data) => {
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(data);
            }
        },
        // When OpenAI session closes → notify browser with reason, then close
        (reason) => {
            activeSessions = Math.max(0, activeSessions - 1);
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ type: 'session.closed', reason }));
                clientWs.close(1000, reason);
            }
        },
        // WS-level transport error (not OpenAI API errors — those come via message events)
        (message) => {
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ type: 'relay.error', message }));
            }
        }
    );

    // Forward browser messages → OpenAI, and reset the inactivity timer each time.
    clientWs.on('message', (data) => {
        openAiSession.resetInactivity();
        openAiSession.send(data);
    });

    clientWs.on('close', (code, reason) => {
        activeSessions = Math.max(0, activeSessions - 1);
        logger.info('Browser client disconnected', {
            sessionId,
            code,
            reason: reason.toString(),
            activeSessions,
        });
        openAiSession.close('client_disconnect');
    });

    clientWs.on('error', (err) => {
        logger.error('Browser client WS error', { sessionId, error: err.message });
        openAiSession.close('client_error');
    });
}
