import WebSocket from 'ws';
import { VoiceSession, VoiceSessionCallbacks } from './VoiceSession';

// Placeholder for the lower-cost STT -> LLM -> TTS pipeline.
// The interface exists now so the frontend-facing contract can stay stable
// while the implementation is added in a later step.
export class TurnBasedVoiceSession implements VoiceSession {
    constructor(
        private readonly sessionId: string,
        _systemPrompt: string,
        private readonly callbacks: VoiceSessionCallbacks,
    ) {
        queueMicrotask(() => {
            this.callbacks.onError('VOICE_MODE=turn-based is not implemented yet. Switch back to VOICE_MODE=realtime.');
            this.callbacks.onClose('turn_based_not_implemented');
        });
    }

    send(_data: WebSocket.RawData | string): void {
        // Intentionally ignored until the turn-based pipeline is implemented.
    }

    resetInactivity(): void {
        // No-op until the turn-based pipeline is implemented.
    }

    close(_reason?: string): void {
        // No-op until the turn-based pipeline is implemented.
    }
}
