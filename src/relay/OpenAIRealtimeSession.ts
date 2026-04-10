import WebSocket from 'ws';
import { config } from '../config';
import { logger } from '../lib/logger';

// Single responsibility: manage one upstream WebSocket session with OpenAI Realtime API.

export class OpenAIRealtimeSession {
    private readonly upstream: WebSocket;
    private readonly sessionId: string;
    private readonly maxDurationTimer: NodeJS.Timeout;
    private inactivityTimer: NodeJS.Timeout;
    private closed = false;
    private closeReason = 'upstream_closed';

    constructor(sessionId: string, onMessage: (data: WebSocket.RawData | string) => void, onClose: (reason: string) => void, onError: (message: string) => void) {
        this.sessionId = sessionId;

        // Hard cap: close session after maxSessionDurationMs no matter what.
        this.maxDurationTimer = setTimeout(() => {
            logger.warn('Session hit max duration limit, closing', { sessionId });
            this.close('max_duration');
        }, config.costGuards.maxSessionDurationMs);

        // Inactivity timer: reset every time the browser sends a message.
        this.inactivityTimer = this.startInactivityTimer();

        this.upstream = new WebSocket(config.openai.realtimeUrl, {
            headers: {
                Authorization: `Bearer ${config.openai.apiKey}`,
                'OpenAI-Beta': 'realtime=v1',
            },
        });

        this.upstream.on('open', () => {
            logger.info('Upstream OpenAI WS connected', { sessionId });
            this.configureSession();
        });

        this.upstream.on('message', (data, isBinary) => {
            this.logIncomingEvent(data);
            // OpenAI sends error events as JSON messages, not WS-level errors.
            // Forward them to the browser and log, but keep the session open.
            // Convert text frames to strings so the relay sends text WS frames to the browser.
            onMessage(isBinary ? data : data.toString());
        });

        this.upstream.on('error', (err) => {
            logger.error('Upstream OpenAI WS error', { sessionId, error: err.message });
            onError(err.message);
        });

        this.upstream.on('close', (code, reason) => {
            logger.info('Upstream OpenAI WS closed', {
                sessionId,
                code,
                reason: reason.toString(),
            });
            this.clearTimers();
            onClose(this.closeReason);
        });
    }

    /** Called by relayHandler each time the browser sends a message — resets inactivity clock. */
    resetInactivity(): void {
        clearTimeout(this.inactivityTimer);
        this.inactivityTimer = this.startInactivityTimer();
    }

    send(data: WebSocket.RawData | string): void {
        if (this.closed) return; // session already shutting down — silently drop
        if (this.upstream.readyState === WebSocket.OPEN) {
            this.upstream.send(data);
        } else {
            logger.warn('Attempted to send to upstream WS that is not open', {
                sessionId: this.sessionId,
                readyState: this.upstream.readyState,
            });
        }
    }

    close(reason = 'normal'): void {
        if (this.closed) return;
        this.closed = true;
        this.closeReason = reason;
        this.clearTimers();
        logger.info('Closing OpenAI session', { sessionId: this.sessionId, reason });
        if (this.upstream.readyState === WebSocket.OPEN) {
            this.upstream.close(1000, reason);
        }
    }

    private startInactivityTimer(): NodeJS.Timeout {
        return setTimeout(() => {
            logger.warn('Session inactivity timeout, closing', { sessionId: this.sessionId });
            this.close('inactivity');
        }, config.costGuards.inactivityTimeoutMs);
    }

    private clearTimers(): void {
        clearTimeout(this.maxDurationTimer);
        clearTimeout(this.inactivityTimer);
    }

    // Send session.update to configure model, voice, VAD, and audio formats.
    private configureSession(): void {
        const sessionUpdate = {
            type: 'session.update',
            session: {
                model: config.openai.model,
                modalities: ['text', 'audio'],
                voice: config.openai.voice,
                input_audio_format: config.openai.inputAudioFormat,
                output_audio_format: config.openai.outputAudioFormat,
                turn_detection: {
                    type: 'server_vad',
                    threshold: config.openai.vadThreshold,
                    silence_duration_ms: config.openai.silenceDurationMs,
                },
                // Phase 4 will replace this placeholder with real persona + Redis knowledge.
                instructions:
                    'You are Yubi, a software engineer. Be concise, friendly, and helpful.',
            },
        };

        this.upstream.send(JSON.stringify(sessionUpdate));
        logger.debug('Sent session.update to OpenAI', { sessionId: this.sessionId });
    }

    private logIncomingEvent(data: WebSocket.RawData): void {
        try {
            const parsed = JSON.parse(data.toString()) as { type?: string; error?: { code?: string; message?: string } };
            if (parsed.type === 'error') {
                logger.error('OpenAI API error event', {
                    sessionId: this.sessionId,
                    code: parsed.error?.code,
                    message: parsed.error?.message,
                });
            } else {
                logger.debug('OpenAI event received', {
                    sessionId: this.sessionId,
                    eventType: parsed.type ?? 'unknown',
                });
            }
        } catch {
            // binary or non-JSON frame — ignore for logging purposes
        }
    }
}
