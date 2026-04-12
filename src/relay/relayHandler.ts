import WebSocket from 'ws';
import { IncomingMessage } from 'http';
import { logger } from '../lib/logger';
import { config } from '../config';
import { knowledgeProvider, buildSystemPrompt } from '../knowledge';
import { getClientIp, wsConnectionLimiter, wsControlMessageLimiter } from '../security/rateLimit';
import { AccessTokenClaims, extractAccessToken, TokenError, verifyAccessToken } from '../security/tokenAuth';
import { createVoiceSession } from '../voice';

// Single responsibility: manage the relay between one browser client and one OpenAI session.

// Module-level concurrent session counter — shared across all connections.
let activeSessions = 0;

const allowedClientMessageTypes = new Set([
    'input_audio_buffer.append',
    'input_audio_buffer.clear',
    'input_audio_buffer.commit',
    'response.cancel',
]);

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

function closeWithPolicyViolation(clientWs: WebSocket, reason: string): void {
    if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.close(1008, reason);
    }
}

function parseAndValidateClientMessage(raw: string): { type: string; audio?: string } | null {
    const parsed = JSON.parse(raw) as { type?: unknown; audio?: unknown };
    if (typeof parsed.type !== 'string' || !allowedClientMessageTypes.has(parsed.type)) {
        return null;
    }
    if (parsed.type === 'input_audio_buffer.append' && typeof parsed.audio !== 'string') {
        return null;
    }
    return {
        type: parsed.type,
        ...(typeof parsed.audio === 'string' ? { audio: parsed.audio } : {}),
    };
}

function authenticateRequest(req: IncomingMessage): AccessTokenClaims | null {
    if (!config.auth.requireAuth) {
        return null;
    }

    const token = extractAccessToken(req, config.auth.queryParamName);
    if (!token) {
        throw new TokenError('missing_access_token');
    }

    return verifyAccessToken(config.auth.signingSecret, token, 'access');
}

export async function handleClientConnection(clientWs: WebSocket, req: IncomingMessage): Promise<void> {
    const origin = req.headers.origin;
    const clientIp = getClientIp(req);

    // Origin check — reject connections from unknown origins in production.
    if (!isOriginAllowed(origin)) {
        logger.warn('Rejected WS connection from disallowed origin', { origin, clientIp });
        closeWithPolicyViolation(clientWs, 'Origin not allowed');
        return;
    }

    let authClaims: AccessTokenClaims | null = null;
    try {
        authClaims = authenticateRequest(req);
    } catch (error) {
        const reason = error instanceof TokenError ? error.code : 'auth_failed';
        logger.warn('Rejected WS connection during auth', { origin, clientIp, reason });
        closeWithPolicyViolation(clientWs, 'Unauthorized');
        return;
    }

    const connectRateDecision = wsConnectionLimiter.decide(
        `ws-connect:${clientIp}`,
        config.websocket.connectRateLimit,
        config.websocket.connectRateWindowMs,
    );
    if (!connectRateDecision.allowed) {
        logger.warn('Rejected WS connection due to rate limit', {
            clientIp,
            retryAfterMs: connectRateDecision.retryAfterMs,
        });
        closeWithPolicyViolation(clientWs, 'Too many connection attempts');
        return;
    }

    // Concurrent session cap — reject if already at the limit.
    if (activeSessions >= config.costGuards.maxConcurrentSessions) {
        logger.warn('Rejected WS connection: concurrent session limit reached', {
            activeSessions,
            clientIp,
            limit: config.costGuards.maxConcurrentSessions,
        });
        clientWs.close(1013, 'Server at capacity');
        return;
    }

    activeSessions++;
    const sessionId = generateSessionId();
    let releasedSession = false;

    const releaseSession = (): void => {
        if (releasedSession) return;
        releasedSession = true;
        activeSessions = Math.max(0, activeSessions - 1);
    };

    logger.info('Browser client connected', {
        sessionId,
        activeSessions,
        clientIp,
        authSid: authClaims?.sid,
    });

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
                releaseSession();
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
        if (isBinary) {
            logger.warn('Rejected binary browser message', { sessionId, clientIp });
            clientWs.close(1003, 'Binary messages are not supported');
            return;
        }

        const raw = data.toString();
        if (Buffer.byteLength(raw, 'utf8') > config.websocket.maxMessageBytes) {
            logger.warn('Rejected oversized browser message', { sessionId, clientIp });
            clientWs.close(1009, 'Message too large');
            return;
        }

        let parsedMessage: { type: string; audio?: string } | null = null;
        try {
            parsedMessage = parseAndValidateClientMessage(raw);
        } catch {
            clientWs.close(1007, 'Malformed JSON');
            return;
        }

        if (!parsedMessage) {
            logger.warn('Rejected unsupported browser message', { sessionId, clientIp });
            closeWithPolicyViolation(clientWs, 'Unsupported client event');
            return;
        }

        if (parsedMessage.type !== 'input_audio_buffer.append') {
            const controlRateDecision = wsControlMessageLimiter.decide(
                `ws-control:${authClaims?.sid ?? clientIp}`,
                config.websocket.controlRateLimit,
                config.websocket.controlRateWindowMs,
            );
            if (!controlRateDecision.allowed) {
                logger.warn('Rejected browser control message due to rate limit', {
                    sessionId,
                    clientIp,
                    authSid: authClaims?.sid,
                    eventType: parsedMessage.type,
                    retryAfterMs: controlRateDecision.retryAfterMs,
                });
                closeWithPolicyViolation(clientWs, 'Rate limited');
                return;
            }

            voiceSession.resetInactivity();
        }

        voiceSession.send(raw);
    });

    clientWs.on('close', (code, reason) => {
        releaseSession();
        logger.info('Browser client disconnected', {
            sessionId,
            code,
            reason: reason.toString(),
            activeSessions,
            clientIp,
            authSid: authClaims?.sid,
        });
        voiceSession.close('client_disconnect');
    });

    clientWs.on('error', (err) => {
        logger.error('Browser client WS error', { sessionId, clientIp, error: err.message });
        voiceSession.close('client_error');
    });
}
