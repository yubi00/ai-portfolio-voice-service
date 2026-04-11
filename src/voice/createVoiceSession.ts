import { config } from '../config';
import { logger } from '../lib/logger';
import { RealtimeVoiceSessionAdapter } from './RealtimeVoiceSessionAdapter';
import { TurnBasedVoiceSession } from './TurnBasedVoiceSession';
import { VoiceSession, VoiceSessionCallbacks } from './VoiceSession';

export function createVoiceSession(
    sessionId: string,
    systemPrompt: string,
    callbacks: VoiceSessionCallbacks,
): VoiceSession {
    logger.info('Creating voice session', {
        sessionId,
        mode: config.voice.mode,
    });

    switch (config.voice.mode) {
        case 'realtime':
            return new RealtimeVoiceSessionAdapter(sessionId, systemPrompt, callbacks);
        case 'turn-based':
            return new TurnBasedVoiceSession(sessionId, systemPrompt, callbacks);
        default: {
            const exhaustiveMode: never = config.voice.mode;
            throw new Error(`Unsupported voice mode: ${String(exhaustiveMode)}`);
        }
    }
}
