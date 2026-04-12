// Central config — all constants live here, no magic strings/numbers elsewhere.

import dotenv from 'dotenv';
dotenv.config();

function requireEnv(key: string): string {
    const value = process.env[key];
    if (!value) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
}

function optionalInt(key: string, defaultValue: number): number {
    const raw = process.env[key];
    if (!raw) return defaultValue;
    const parsed = parseInt(raw, 10);
    if (isNaN(parsed)) throw new Error(`Env var ${key} must be an integer, got: "${raw}"`);
    return parsed;
}

function optionalVoiceMode(key: string, defaultValue: 'realtime' | 'turn-based'): 'realtime' | 'turn-based' {
    const raw = process.env[key];
    if (!raw) return defaultValue;
    if (raw === 'realtime' || raw === 'turn-based') return raw;
    throw new Error(`Env var ${key} must be one of: realtime, turn-based. Got: "${raw}"`);
}

function optionalFloat(key: string, defaultValue: number): number {
    const raw = process.env[key];
    if (!raw) return defaultValue;
    const parsed = parseFloat(raw);
    if (isNaN(parsed)) throw new Error(`Env var ${key} must be a number, got: "${raw}"`);
    return parsed;
}

function optionalString(key: string, defaultValue: string): string {
    return process.env[key] ?? defaultValue;
}

function optionalBoolean(key: string, defaultValue: boolean): boolean {
    const raw = process.env[key];
    if (!raw) return defaultValue;
    const normalized = raw.trim().toLowerCase();
    if (['1', 'true', 'yes'].includes(normalized)) return true;
    if (['0', 'false', 'no'].includes(normalized)) return false;
    throw new Error(`Env var ${key} must be a boolean, got: "${raw}"`);
}

const requireAuth = optionalBoolean('REQUIRE_AUTH', false);
const authSigningSecret = requireAuth ? requireEnv('AUTH_SIGNING_SECRET') : optionalString('AUTH_SIGNING_SECRET', '');

export const config = {
    port: parseInt(process.env.PORT ?? '3001', 10),
    nodeEnv: process.env.NODE_ENV ?? 'development',

    auth: {
        requireAuth,
        signingSecret: authSigningSecret,
        queryParamName: optionalString('VOICE_AUTH_QUERY_PARAM', 'access_token'),
    },

    websocket: {
        maxMessageBytes: optionalInt('WS_MAX_MESSAGE_BYTES', 256 * 1024),
        connectRateLimit: optionalInt('WS_CONNECT_RATE_LIMIT', 12),
        connectRateWindowMs: optionalInt('WS_CONNECT_RATE_WINDOW_MS', 60 * 1000),
        controlRateLimit: optionalInt('WS_CONTROL_RATE_LIMIT', 120),
        controlRateWindowMs: optionalInt('WS_CONTROL_RATE_WINDOW_MS', 60 * 1000),
    },

    voice: {
        mode: optionalVoiceMode('VOICE_MODE', 'realtime'),
        turnBased: {
            transcriptionModel: process.env.TURN_BASED_TRANSCRIPTION_MODEL ?? 'whisper-1',
            chatModel: process.env.TURN_BASED_CHAT_MODEL ?? 'gpt-4o-mini',
            ttsModel: process.env.TURN_BASED_TTS_MODEL ?? 'gpt-4o-mini-tts',
            silenceThreshold: optionalFloat('TURN_BASED_SILENCE_THRESHOLD', 0.015),
            silenceDurationMs: optionalInt('TURN_BASED_SILENCE_DURATION_MS', 450),
            minSpeechDurationMs: optionalInt('TURN_BASED_MIN_SPEECH_DURATION_MS', 180),
            pcmChunkBytes: optionalInt('TURN_BASED_PCM_CHUNK_BYTES', 4800),
            maxHistoryMessages: optionalInt('TURN_BASED_MAX_HISTORY_MESSAGES', 8),
        },
    },

    openai: {
        apiKey: requireEnv('OPENAI_API_KEY'),
        model: 'gpt-4o-realtime-preview',
        get realtimeUrl() { return `wss://api.openai.com/v1/realtime?model=${this.model}`; },
        voice: optionalString('OPENAI_VOICE', 'echo'),
        inputAudioFormat: 'pcm16' as const,
        outputAudioFormat: 'pcm16' as const,
        silenceDurationMs: 600,
        vadThreshold: 0.5,
    },

    // Cost guards — keeps the OpenAI Realtime API bill predictable.
    // All values are overridable via environment variables.
    costGuards: {
        // Hard cap on how long a single session can stay open regardless of activity.
        maxSessionDurationMs: optionalInt('MAX_SESSION_DURATION_MS', 5 * 60 * 1000), // default: 5 min
        // Auto-close if no audio/messages received from the browser for this long.
        inactivityTimeoutMs: optionalInt('INACTIVITY_TIMEOUT_MS', 30 * 1000), // default: 30s
        // Max simultaneous OpenAI WS sessions across all browser clients.
        maxConcurrentSessions: optionalInt('MAX_CONCURRENT_SESSIONS', 3), // default: 3
        // Allowed browser origins. Empty = allow all (dev only).
        allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '').split(',').filter(Boolean),
    },
} as const;
