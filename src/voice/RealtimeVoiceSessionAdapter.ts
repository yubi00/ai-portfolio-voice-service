import { OpenAIRealtimeSession } from '../relay/OpenAIRealtimeSession';
import { VoiceSession, VoiceSessionCallbacks } from './VoiceSession';

// Thin wrapper around the existing Realtime implementation.
// This preserves current behavior while exposing a backend-agnostic contract.
export class RealtimeVoiceSessionAdapter implements VoiceSession {
    private readonly session: OpenAIRealtimeSession;

    constructor(sessionId: string, systemPrompt: string, callbacks: VoiceSessionCallbacks) {
        this.session = new OpenAIRealtimeSession(
            sessionId,
            systemPrompt,
            callbacks.onMessage,
            callbacks.onClose,
            callbacks.onError,
        );
    }

    send(data: import('ws').RawData | string): void {
        this.session.send(data);
    }

    resetInactivity(): void {
        this.session.resetInactivity();
    }

    close(reason?: string): void {
        this.session.close(reason);
    }
}
