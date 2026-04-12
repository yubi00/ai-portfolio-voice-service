import crypto from 'crypto';
import { IncomingMessage } from 'http';

export type AccessTokenClaims = {
    typ: string;
    sid: string;
    iat: number;
    exp: number;
    [key: string]: unknown;
};

export class TokenError extends Error {
    constructor(public readonly code: string) {
        super(code);
        this.name = 'TokenError';
    }
}

function decodeBase64Url(value: string): Buffer {
    const padding = '='.repeat((4 - (value.length % 4)) % 4);
    return Buffer.from(value + padding, 'base64url');
}

function sign(secret: string, value: string): string {
    return crypto
        .createHmac('sha256', secret)
        .update(value)
        .digest('base64url');
}

function signaturesMatch(actual: string, expected: string): boolean {
    const actualBuffer = Buffer.from(actual);
    const expectedBuffer = Buffer.from(expected);
    if (actualBuffer.length !== expectedBuffer.length) {
        return false;
    }
    return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

export function extractAccessToken(req: IncomingMessage, queryParamName: string): string | null {
    const authorization = req.headers.authorization;
    if (authorization?.toLowerCase().startsWith('bearer ')) {
        return authorization.split(' ', 2)[1]?.trim() ?? null;
    }

    const rawUrl = req.url ?? '/';
    const parsedUrl = new URL(rawUrl, 'http://localhost');
    const queryToken = parsedUrl.searchParams.get(queryParamName);
    if (queryToken) {
        return queryToken;
    }

    const subprotocolHeader = req.headers['sec-websocket-protocol'];
    if (typeof subprotocolHeader === 'string') {
        const values = subprotocolHeader.split(',').map((value) => value.trim()).filter(Boolean);
        const bearerIndex = values.findIndex((value) => value.toLowerCase() === 'bearer');
        if (bearerIndex >= 0) {
            return values[bearerIndex + 1] ?? null;
        }
    }

    return null;
}

export function verifyAccessToken(secret: string, token: string, expectedType = 'access'): AccessTokenClaims {
    if (!secret) {
        throw new TokenError('missing_signing_secret');
    }

    const parts = token.split('.');
    const header = parts[0];
    const payload = parts[1];
    const signature = parts[2];
    if (!header || !payload || !signature || parts.length !== 3) {
        throw new TokenError('malformed_token');
    }

    const message = `${header}.${payload}`;
    const expectedSignature = sign(secret, message);
    if (!signaturesMatch(signature, expectedSignature)) {
        throw new TokenError('bad_signature');
    }

    let decodedPayload: unknown;
    try {
        decodedPayload = JSON.parse(decodeBase64Url(payload).toString('utf8'));
    } catch {
        throw new TokenError('bad_payload');
    }

    if (!decodedPayload || typeof decodedPayload !== 'object') {
        throw new TokenError('bad_payload');
    }

    const claims = decodedPayload as Record<string, unknown>;
    if (claims.typ !== expectedType) {
        throw new TokenError('wrong_token_type');
    }

    if (typeof claims.sid !== 'string' || !claims.sid) {
        throw new TokenError('missing_sid');
    }

    const exp = Number(claims.exp ?? 0);
    const iat = Number(claims.iat ?? 0);
    if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) {
        throw new TokenError('token_expired');
    }

    return {
        ...claims,
        typ: String(claims.typ),
        sid: claims.sid,
        iat,
        exp,
    };
}
