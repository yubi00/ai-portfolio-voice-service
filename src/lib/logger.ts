// Minimal structured logger — log level awareness, no magic strings.

import { config } from '../config';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    const isDev = config.nodeEnv === 'development';
    const entry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        ...(meta ? { meta } : {}),
    };

    if (level === 'error') {
        console.error(JSON.stringify(entry));
    } else if (level === 'debug' && !isDev) {
        // suppress debug logs in production
        return;
    } else {
        console.log(JSON.stringify(entry));
    }
}

export const logger = {
    info: (msg: string, meta?: Record<string, unknown>) => log('info', msg, meta),
    warn: (msg: string, meta?: Record<string, unknown>) => log('warn', msg, meta),
    error: (msg: string, meta?: Record<string, unknown>) => log('error', msg, meta),
    debug: (msg: string, meta?: Record<string, unknown>) => log('debug', msg, meta),
};
