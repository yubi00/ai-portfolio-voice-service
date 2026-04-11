import WebSocket from 'ws';
import { config } from '../config';
import { formatFeaturedProjectsForPrompt } from '../knowledge/featuredProjects';
import { formatProfileContextForPrompt } from '../knowledge/profileContext';
import { findRelevantGithubProjects, formatGithubProjectsForPrompt, shouldUseGithubProjectContext } from '../knowledge/githubProjects';
import { logger } from '../lib/logger';

// Single responsibility: manage one upstream WebSocket session with OpenAI Realtime API.

const REALTIME_RESPONSE_STYLE = [
    'Follow the existing session instructions and stay in the established Yubi persona.',
    'Always respond in English unless the user explicitly asks for another language.',
    'Keep voice responses natural and concise. Usually answer in two to four spoken sentences unless the user asks for more detail.',
    'Sound conversational and unscripted, like Yubi answering naturally in an interview, not like reading from a script, book, or polished product summary.',
    'Stay tightly grounded in the provided portfolio knowledge for this conversation. For broad project questions such as which project you are most proud of or what someone should look at first, answer from the curated Key Projects section rather than improvising.',
    'If the provided knowledge does not support a detail, say that directly instead of guessing.',
].join(' ');

export class OpenAIRealtimeSession {
    private readonly upstream: WebSocket;
    private readonly sessionId: string;
    private readonly systemPrompt: string;
    private readonly maxDurationTimer: NodeJS.Timeout;
    private inactivityTimer: NodeJS.Timeout;
    private closed = false;
    private closeReason = 'upstream_closed';
    private readonly handledTranscriptItemIds = new Set<string>();

    constructor(sessionId: string, systemPrompt: string, onMessage: (data: WebSocket.RawData | string) => void, onClose: (reason: string) => void, onError: (message: string) => void) {
        this.sessionId = sessionId;
        this.systemPrompt = systemPrompt;

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
            const raw = isBinary ? data : data.toString();
            // Reset inactivity when the AI finishes a response — active conversation
            // should never be timed out mid-exchange.
            if (!isBinary) {
                try {
                    const parsed = JSON.parse(raw as string) as { type?: string; transcript?: string; item_id?: string };
                    if (parsed.type === 'response.done') {
                        this.resetInactivity();
                    }
                    if (parsed.type === 'conversation.item.input_audio_transcription.completed' && parsed.transcript) {
                        this.handleCompletedTranscript(parsed.transcript, parsed.item_id);
                    }
                } catch { /* ignore */ }
            }
            onMessage(raw);
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
                input_audio_transcription: { model: 'whisper-1' },
                turn_detection: {
                    type: 'server_vad',
                    threshold: config.openai.vadThreshold,
                    silence_duration_ms: config.openai.silenceDurationMs,
                    create_response: false,
                },
                instructions: this.systemPrompt,
            },
        };

        this.upstream.send(JSON.stringify(sessionUpdate));
        logger.debug('Sent session.update to OpenAI', { sessionId: this.sessionId });
    }

    private handleCompletedTranscript(transcript: string, itemId?: string): void {
        const trimmedTranscript = transcript.trim();
        if (!trimmedTranscript) return;
        if (itemId && this.handledTranscriptItemIds.has(itemId)) return;
        if (itemId) {
            this.handledTranscriptItemIds.add(itemId);
        }

        const profileContext = formatProfileContextForPrompt(trimmedTranscript);
        const featuredProjectContext = formatFeaturedProjectsForPrompt(trimmedTranscript);
        const matchedProjects = shouldUseGithubProjectContext(trimmedTranscript)
            ? findRelevantGithubProjects(trimmedTranscript, 3)
            : [];
        const matchedProjectContext = formatGithubProjectsForPrompt(matchedProjects);

        logger.debug('Creating realtime response with per-turn project context', {
            sessionId: this.sessionId,
            transcriptChars: trimmedTranscript.length,
            usedProfileContext: Boolean(profileContext),
            usedFeaturedProjectsContext: Boolean(featuredProjectContext),
            matchedProjects: matchedProjects.map((project) => project.name),
        });

        this.sendResponseCreate(profileContext, featuredProjectContext, matchedProjectContext);
    }

    private sendResponseCreate(profileContext: string | null, featuredProjectContext: string | null, projectContext: string | null): void {
        if (this.upstream.readyState !== WebSocket.OPEN) return;

        const contextParts = [profileContext, featuredProjectContext, projectContext].filter((value): value is string => Boolean(value));

        const responseCreate = {
            type: 'response.create',
            response: {
                instructions: contextParts.length > 0
                    ? `${REALTIME_RESPONSE_STYLE}\n\n${contextParts.join('\n\n')}`
                    : REALTIME_RESPONSE_STYLE,
            },
        };

        this.upstream.send(JSON.stringify(responseCreate));
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
