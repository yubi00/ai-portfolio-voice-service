// Shared browser-facing event contract for all voice backends.
// The current Realtime path forwards raw OpenAI events, but future backends
// should be able to map into these semantic events without changing frontend code.

export type VoiceClientState = 'idle' | 'listening' | 'thinking' | 'speaking';

export interface VoiceTranscriptDeltaEvent {
    type: 'voice.transcript.delta';
    speaker: 'user' | 'assistant';
    text: string;
}

export interface VoiceTranscriptDoneEvent {
    type: 'voice.transcript.done';
    speaker: 'user' | 'assistant';
    text: string;
}

export interface VoiceStateEvent {
    type: 'voice.state';
    state: VoiceClientState;
}

export interface VoiceErrorEvent {
    type: 'voice.error';
    message: string;
}

export interface VoiceSessionClosedEvent {
    type: 'voice.session.closed';
    reason: string;
}

export type VoiceServerEvent =
    | VoiceTranscriptDeltaEvent
    | VoiceTranscriptDoneEvent
    | VoiceStateEvent
    | VoiceErrorEvent
    | VoiceSessionClosedEvent;
