import express from 'express';
import http from 'http';
import path from 'path';
import { WebSocketServer } from 'ws';
import { config } from './config';
import { logger } from './lib/logger';
import { healthRouter } from './http/healthRouter';
import { handleClientConnection } from './relay/relayHandler';

// Composition root — wire everything together. No business logic here.

const app = express();
app.use(express.json());
app.use(healthRouter);

// Dev-only: serve the audio test page at /test
if (config.nodeEnv === 'development') {
    const testPagePath = path.resolve(process.cwd(), 'public', 'test.html');
    app.get('/test', (_req, res) => res.sendFile(testPagePath));
    logger.info('Dev test page available', { url: `http://localhost:${config.port}/test` });
}

const server = http.createServer(app);

// WebSocket server attached to the same HTTP server, scoped to /ws path.
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
    handleClientConnection(ws, req).catch((err: unknown) => {
        logger.error('Unhandled error in handleClientConnection', { error: String(err) });
        ws.close(1011, 'Internal server error');
    });
});

wss.on('error', (err) => {
    logger.error('WebSocket server error', { error: err.message });
});

server.listen(config.port, () => {
    logger.info('Voice service started', {
        port: config.port,
        env: config.nodeEnv,
        model: config.openai.model,
    });
});

// Graceful shutdown
function shutdown(signal: string): void {
    logger.info(`Received ${signal}, shutting down gracefully`);
    server.close(() => {
        logger.info('HTTP server closed');
        process.exit(0);
    });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
