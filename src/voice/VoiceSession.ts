import WebSocket from 'ws';

export type VoiceMode = 'realtime' | 'turn-based';

export interface VoiceSessionCallbacks {
    onMessage: (data: WebSocket.RawData | string) => void;
    onClose: (reason: string) => void;
    onError: (message: string) => void;
}

export interface VoiceSession {
    send(data: WebSocket.RawData | string): void;
    resetInactivity(): void;
    close(reason?: string): void;
}
