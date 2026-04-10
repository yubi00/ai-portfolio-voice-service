// Minimal structured logger — log level awareness, file + console output.

import fs from 'fs';
import path from 'path';
import { config } from '../config';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

// ─── File stream setup ───────────────────────────────────────────────────────
// Writes every log line (including debug) to a rolling daily log file.
// File path: logs/app-YYYY-MM-DD.log — one file per day, auto-created.
const logsDir = path.resolve(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

function getLogFilePath(): string {
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return path.join(logsDir, `app-${date}.log`);
}

// Open in append mode; a new stream is created when the date changes.
let currentLogDate = new Date().toISOString().slice(0, 10);
let fileStream = fs.createWriteStream(getLogFilePath(), { flags: 'a' });

function getFileStream(): fs.WriteStream {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== currentLogDate) {
        fileStream.end();
        currentLogDate = today;
        fileStream = fs.createWriteStream(getLogFilePath(), { flags: 'a' });
    }
    return fileStream;
}

// ─── Core log function ───────────────────────────────────────────────────────
function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    const isDev = config.nodeEnv === 'development';
    const entry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        ...(meta ? { meta } : {}),
    };
    const line = JSON.stringify(entry);

    // Always write everything to file (useful for post-session debugging).
    getFileStream().write(line + '\n');

    // Console: suppress debug in production.
    if (level === 'debug' && !isDev) return;

    if (level === 'error') {
        console.error(line);
    } else {
        console.log(line);
    }
}

export const logger = {
    info: (msg: string, meta?: Record<string, unknown>) => log('info', msg, meta),
    warn: (msg: string, meta?: Record<string, unknown>) => log('warn', msg, meta),
    error: (msg: string, meta?: Record<string, unknown>) => log('error', msg, meta),
    debug: (msg: string, meta?: Record<string, unknown>) => log('debug', msg, meta),
};
