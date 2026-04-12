import { IncomingMessage } from 'http';

type RateLimitDecision = {
    allowed: boolean;
    limit: number;
    remaining: number;
    retryAfterMs: number;
    resetAtMs: number;
};

type CounterState = {
    windowStartMs: number;
    count: number;
};

export class FixedWindowRateLimiter {
    private readonly counters = new Map<string, CounterState>();

    decide(key: string, limit: number, windowMs: number, nowMs = Date.now()): RateLimitDecision {
        if (limit <= 0) {
            throw new Error('limit must be greater than 0');
        }
        if (windowMs <= 0) {
            throw new Error('windowMs must be greater than 0');
        }

        const windowStartMs = Math.floor(nowMs / windowMs) * windowMs;
        const resetAtMs = windowStartMs + windowMs;
        const current = this.counters.get(key);
        const state = !current || current.windowStartMs !== windowStartMs
            ? { windowStartMs, count: 0 }
            : current;

        if (state.count < limit) {
            state.count += 1;
            this.counters.set(key, state);
            return {
                allowed: true,
                limit,
                remaining: Math.max(0, limit - state.count),
                retryAfterMs: 0,
                resetAtMs,
            };
        }

        this.counters.set(key, state);
        return {
            allowed: false,
            limit,
            remaining: 0,
            retryAfterMs: Math.max(0, resetAtMs - nowMs),
            resetAtMs,
        };
    }
}

export function getClientIp(req: IncomingMessage): string {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (typeof forwardedFor === 'string') {
        const first = forwardedFor.split(',')[0]?.trim();
        if (first) return first;
    }

    const realIp = req.headers['x-real-ip'];
    if (typeof realIp === 'string' && realIp.trim()) {
        return realIp.trim();
    }

    return req.socket.remoteAddress ?? 'unknown';
}

export const wsConnectionLimiter = new FixedWindowRateLimiter();
export const wsControlMessageLimiter = new FixedWindowRateLimiter();
