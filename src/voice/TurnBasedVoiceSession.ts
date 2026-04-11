import WebSocket from 'ws';
import OpenAI, { toFile } from 'openai';
import { config } from '../config';
import { findRelevantGithubProjects, formatGithubProjectsForPrompt } from '../knowledge/githubProjects';
import { logger } from '../lib/logger';
import { VoiceSession, VoiceSessionCallbacks } from './VoiceSession';

const TURN_BASED_RESPONSE_STYLE = 'You are in turn-based voice mode. Keep replies concise and spoken: usually 1 to 2 short sentences, roughly under 45 words unless the user explicitly asks for more detail.';

type ChatMessage = {
    role: 'user' | 'assistant';
    content: string;
};

export class TurnBasedVoiceSession implements VoiceSession {
    private readonly client = new OpenAI({ apiKey: config.openai.apiKey });
    private readonly maxDurationTimer: NodeJS.Timeout;
    private inactivityTimer: NodeJS.Timeout;
    private readonly history: ChatMessage[] = [];
    private readonly pcmChunks: Buffer[] = [];
    private readonly queuedAudioChunks: Buffer[] = [];
    private speechActive = false;
    private speechDurationMs = 0;
    private silenceDurationMs = 0;
    private processingTurn = false;
    private flushingQueuedAudio = false;
    private closed = false;
    private closeReason = 'normal';
    private responseCounter = 0;
    private abortController: AbortController | null = null;
    private activeResponseId: string | null = null;

    constructor(
        private readonly sessionId: string,
        private readonly systemPrompt: string,
        private readonly callbacks: VoiceSessionCallbacks,
    ) {
        this.maxDurationTimer = setTimeout(() => {
            logger.warn('Turn-based session hit max duration limit, closing', { sessionId });
            this.close('max_duration');
        }, config.costGuards.maxSessionDurationMs);

        this.inactivityTimer = this.startInactivityTimer();

        queueMicrotask(() => {
            logger.info('Turn-based voice session created', {
                sessionId: this.sessionId,
                transcriptionModel: config.voice.turnBased.transcriptionModel,
                chatModel: config.voice.turnBased.chatModel,
                ttsModel: config.voice.turnBased.ttsModel,
            });
            this.emit({ type: 'session.created', session: { id: this.sessionId, mode: 'turn-based' } });
            this.emit({
                type: 'session.updated',
                session: {
                    mode: 'turn-based',
                    transcription_model: config.voice.turnBased.transcriptionModel,
                    chat_model: config.voice.turnBased.chatModel,
                    tts_model: config.voice.turnBased.ttsModel,
                },
            });
        });
    }

    send(data: WebSocket.RawData | string): void {
        if (this.closed) return;

        if (typeof data !== 'string') return;

        let parsed: { type?: string; audio?: string };
        try {
            parsed = JSON.parse(data) as { type?: string; audio?: string };
        } catch {
            return;
        }

        switch (parsed.type) {
            case 'input_audio_buffer.append':
                if (parsed.audio) {
                    this.handleAudioAppend(parsed.audio).catch((error) => {
                        logger.error('Turn-based audio append failed', {
                            sessionId: this.sessionId,
                            error: String(error),
                        });
                        this.callbacks.onError('Turn-based audio processing failed.');
                    });
                }
                break;
            case 'response.cancel':
                this.cancelActiveResponse();
                break;
            default:
                this.resetInactivity();
                break;
        }
    }

    resetInactivity(): void {
        clearTimeout(this.inactivityTimer);
        this.inactivityTimer = this.startInactivityTimer();
    }

    close(reason = 'normal'): void {
        if (this.closed) return;
        this.closed = true;
        this.closeReason = reason;
        logger.info('Closing turn-based voice session', {
            sessionId: this.sessionId,
            reason,
            hadActiveResponse: Boolean(this.activeResponseId),
        });
        this.abortController?.abort();
        this.clearTimers();
        this.callbacks.onClose(reason);
    }

    private startInactivityTimer(): NodeJS.Timeout {
        return setTimeout(() => {
            logger.warn('Turn-based session inactivity timeout, closing', { sessionId: this.sessionId });
            this.close('inactivity');
        }, config.costGuards.inactivityTimeoutMs);
    }

    private clearTimers(): void {
        clearTimeout(this.maxDurationTimer);
        clearTimeout(this.inactivityTimer);
    }

    private emit(payload: Record<string, unknown>): void {
        this.callbacks.onMessage(JSON.stringify(payload));
    }

    private async handleAudioAppend(base64Audio: string): Promise<void> {
        this.resetInactivity();
        const chunk = Buffer.from(base64Audio, 'base64');
        if (this.processingTurn) {
            this.handleQueuedAudioDuringProcessing(chunk);
            return;
        }

        await this.ingestAudioChunk(chunk);
    }

    private handleQueuedAudioDuringProcessing(chunk: Buffer): void {
        const rms = computePcm16Rms(chunk);
        const isSpeech = rms >= config.voice.turnBased.silenceThreshold;

        if (!isSpeech && !this.speechActive && this.queuedAudioChunks.length === 0) {
            return;
        }

        this.queuedAudioChunks.push(chunk);

        if (isSpeech && !this.speechActive) {
            this.speechActive = true;
            logger.debug('Turn-based interruption speech started during active turn', {
                sessionId: this.sessionId,
                rms,
                responseId: this.activeResponseId,
            });
            this.emit({ type: 'input_audio_buffer.speech_started' });
            this.cancelActiveResponse();
        }
    }

    private async ingestAudioChunk(chunk: Buffer): Promise<void> {
        const rms = computePcm16Rms(chunk);
        const durationMs = getPcm16ChunkDurationMs(chunk);
        const isSpeech = rms >= config.voice.turnBased.silenceThreshold;

        if (isSpeech) {
            if (!this.speechActive) {
                this.speechActive = true;
                logger.debug('Turn-based speech started', {
                    sessionId: this.sessionId,
                    rms,
                });
                this.emit({ type: 'input_audio_buffer.speech_started' });
            }
            this.silenceDurationMs = 0;
            this.speechDurationMs += durationMs;
            this.pcmChunks.push(chunk);
            return;
        }

        if (!this.speechActive) return;

        this.silenceDurationMs += durationMs;
        this.pcmChunks.push(chunk);

        if (this.silenceDurationMs < config.voice.turnBased.silenceDurationMs) return;
        if (this.speechDurationMs < config.voice.turnBased.minSpeechDurationMs) {
            logger.debug('Discarding short speech segment in turn-based mode', {
                sessionId: this.sessionId,
                speechDurationMs: this.speechDurationMs,
                silenceDurationMs: this.silenceDurationMs,
            });
            this.resetSpeechBuffer();
            return;
        }

        logger.debug('Turn-based speech stopped', {
            sessionId: this.sessionId,
            speechDurationMs: this.speechDurationMs,
            silenceDurationMs: this.silenceDurationMs,
            bufferedBytes: this.pcmChunks.reduce((sum, part) => sum + part.length, 0),
        });
        this.emit({ type: 'input_audio_buffer.speech_stopped' });
        const utterance = Buffer.concat(this.pcmChunks);
        this.resetSpeechBuffer();
        await this.processTurn(utterance);
    }

    private scheduleQueuedAudioFlush(): void {
        if (this.flushingQueuedAudio || this.closed || this.queuedAudioChunks.length === 0) return;
        queueMicrotask(() => {
            void this.flushQueuedAudio();
        });
    }

    private async flushQueuedAudio(): Promise<void> {
        if (this.flushingQueuedAudio || this.closed) return;
        this.flushingQueuedAudio = true;

        try {
            while (!this.closed && !this.processingTurn && this.queuedAudioChunks.length > 0) {
                const chunk = this.queuedAudioChunks.shift();
                if (!chunk) break;
                await this.ingestAudioChunk(chunk);
            }
        } finally {
            this.flushingQueuedAudio = false;
            if (!this.closed && !this.processingTurn && this.queuedAudioChunks.length > 0) {
                this.scheduleQueuedAudioFlush();
            }
        }
    }

    private resetSpeechBuffer(): void {
        this.speechActive = false;
        this.speechDurationMs = 0;
        this.silenceDurationMs = 0;
        this.pcmChunks.length = 0;
    }

    private async processTurn(pcmAudio: Buffer): Promise<void> {
        this.processingTurn = true;
        this.abortController = new AbortController();

        logger.info('Turn-based turn processing started', {
            sessionId: this.sessionId,
            audioBytes: pcmAudio.length,
        });

        try {
            this.emit({ type: 'input_audio_buffer.committed' });
            this.emit({ type: 'conversation.item.created' });

            const transcript = await this.transcribeAudio(pcmAudio, this.abortController.signal);
            if (!transcript) return;

            logger.info('Turn-based transcription completed', {
                sessionId: this.sessionId,
                transcriptChars: transcript.length,
            });

            this.emit({ type: 'conversation.item.input_audio_transcription.completed', transcript });

            const responseId = this.nextResponseId();
            this.activeResponseId = responseId;
            logger.info('Turn-based assistant response started', {
                sessionId: this.sessionId,
                responseId,
                historyMessages: this.history.length,
            });
            this.emit({ type: 'response.created', response: { id: responseId } });

            const assistantText = await this.generateAssistantText(transcript, responseId, this.abortController.signal);
            if (!assistantText) {
                logger.warn('Turn-based assistant response produced no text', {
                    sessionId: this.sessionId,
                    responseId,
                });
                this.emit({ type: 'response.cancelled', response: { id: responseId } });
                return;
            }

            this.history.push({ role: 'user', content: transcript });
            this.history.push({ role: 'assistant', content: assistantText });
            this.trimHistory();
            logger.info('Turn-based assistant text completed', {
                sessionId: this.sessionId,
                responseId,
                assistantChars: assistantText.length,
                historyMessages: this.history.length,
            });
            this.emit({ type: 'response.audio_transcript.done', response_id: responseId });

            await this.streamTtsAudio(assistantText, responseId, this.abortController.signal);
            if (this.activeResponseId === responseId) {
                logger.info('Turn-based assistant response finished', {
                    sessionId: this.sessionId,
                    responseId,
                });
                this.emit({ type: 'response.done', response: { id: responseId } });
                this.activeResponseId = null;
            }
        } catch (error) {
            if (isAbortError(error)) {
                logger.warn('Turn-based assistant response aborted', {
                    sessionId: this.sessionId,
                    responseId: this.activeResponseId,
                });
                if (this.activeResponseId) {
                    this.emit({ type: 'response.cancelled', response: { id: this.activeResponseId } });
                    this.activeResponseId = null;
                }
            } else {
                logger.error('Turn-based turn processing failed', {
                    sessionId: this.sessionId,
                    error: String(error),
                });
                this.callbacks.onError('Turn-based voice pipeline failed.');
            }
        } finally {
            this.processingTurn = false;
            this.abortController = null;
            this.resetInactivity();
            this.scheduleQueuedAudioFlush();
        }
    }

    private async transcribeAudio(pcmAudio: Buffer, signal: AbortSignal): Promise<string> {
        logger.debug('Turn-based transcription request started', {
            sessionId: this.sessionId,
            audioBytes: pcmAudio.length,
            model: config.voice.turnBased.transcriptionModel,
        });
        const wavAudio = createWavFromPcm16(pcmAudio, 24000, 1);
        const file = await toFile(wavAudio, 'utterance.wav', { type: 'audio/wav' });
        const transcription = await this.client.audio.transcriptions.create(
            {
                file,
                model: config.voice.turnBased.transcriptionModel,
                response_format: 'json',
            },
            { signal },
        );

        logger.debug('Turn-based transcription request finished', {
            sessionId: this.sessionId,
            model: config.voice.turnBased.transcriptionModel,
        });

        return transcription.text.trim();
    }

    private async generateAssistantText(userTranscript: string, responseId: string, signal: AbortSignal): Promise<string> {
        const matchedProjects = findRelevantGithubProjects(userTranscript, 3);
        const matchedProjectContext = formatGithubProjectsForPrompt(matchedProjects);

        logger.debug('Turn-based chat generation started', {
            sessionId: this.sessionId,
            responseId,
            model: config.voice.turnBased.chatModel,
            userChars: userTranscript.length,
            historyMessages: this.history.length,
            matchedProjects: matchedProjects.map((project) => project.name),
        });
        const stream = await this.client.chat.completions.create(
            {
                model: config.voice.turnBased.chatModel,
                stream: true,
                messages: [
                    { role: 'system', content: `${this.systemPrompt}\n\n${TURN_BASED_RESPONSE_STYLE}` },
                    ...(matchedProjectContext ? [{ role: 'system' as const, content: matchedProjectContext }] : []),
                    ...this.history.map((message) => ({ role: message.role, content: message.content })),
                    { role: 'user', content: userTranscript },
                ],
            },
            { signal },
        );

        let fullText = '';
        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content ?? '';
            if (!delta) continue;
            fullText += delta;
            this.emit({ type: 'response.audio_transcript.delta', response_id: responseId, delta });
        }

        logger.debug('Turn-based chat generation finished', {
            sessionId: this.sessionId,
            responseId,
            assistantChars: fullText.length,
        });

        return fullText.trim();
    }

    private async streamTtsAudio(text: string, responseId: string, signal: AbortSignal): Promise<void> {
        logger.debug('Turn-based TTS started', {
            sessionId: this.sessionId,
            responseId,
            model: config.voice.turnBased.ttsModel,
            chars: text.length,
        });
        const response = await this.client.audio.speech.create(
            {
                model: config.voice.turnBased.ttsModel,
                voice: config.openai.voice,
                input: text,
                response_format: 'pcm',
            },
            { signal },
        );

        const pcmAudio = Buffer.from(await response.arrayBuffer());
        const chunkSize = config.voice.turnBased.pcmChunkBytes;
        logger.debug('Turn-based TTS audio ready', {
            sessionId: this.sessionId,
            responseId,
            audioBytes: pcmAudio.length,
            chunkSize,
        });
        for (let offset = 0; offset < pcmAudio.length; offset += chunkSize) {
            if (signal.aborted || this.activeResponseId !== responseId) break;
            const chunk = pcmAudio.subarray(offset, Math.min(offset + chunkSize, pcmAudio.length));
            this.emit({
                type: 'response.audio.delta',
                response_id: responseId,
                delta: chunk.toString('base64'),
            });
        }
        logger.debug('Turn-based TTS streaming finished', {
            sessionId: this.sessionId,
            responseId,
        });
    }

    private trimHistory(): void {
        const maxMessages = config.voice.turnBased.maxHistoryMessages;
        if (this.history.length <= maxMessages) return;
        this.history.splice(0, this.history.length - maxMessages);
    }

    private nextResponseId(): string {
        this.responseCounter += 1;
        return `turn-based-response-${this.sessionId}-${this.responseCounter}`;
    }

    private cancelActiveResponse(): void {
        if (!this.activeResponseId && !this.abortController) return;
        logger.info('Turn-based response cancellation requested', {
            sessionId: this.sessionId,
            responseId: this.activeResponseId,
        });
        this.abortController?.abort();
        if (this.activeResponseId) {
            this.emit({ type: 'response.cancelled', response: { id: this.activeResponseId } });
            this.activeResponseId = null;
        }
    }
}

function computePcm16Rms(buffer: Buffer): number {
    if (buffer.length < 2) return 0;
    let sum = 0;
    let samples = 0;
    for (let offset = 0; offset + 1 < buffer.length; offset += 2) {
        const sample = buffer.readInt16LE(offset) / 32768;
        sum += sample * sample;
        samples += 1;
    }
    return samples === 0 ? 0 : Math.sqrt(sum / samples);
}

function getPcm16ChunkDurationMs(buffer: Buffer, sampleRate = 24000): number {
    const sampleCount = Math.floor(buffer.length / 2);
    return (sampleCount / sampleRate) * 1000;
}

function createWavFromPcm16(pcmAudio: Buffer, sampleRate: number, channels: number): Buffer {
    const bitsPerSample = 16;
    const blockAlign = (channels * bitsPerSample) / 8;
    const byteRate = sampleRate * blockAlign;
    const header = Buffer.alloc(44);

    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcmAudio.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcmAudio.length, 40);

    return Buffer.concat([header, pcmAudio]);
}

function isAbortError(error: unknown): boolean {
    return error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted'));
}
