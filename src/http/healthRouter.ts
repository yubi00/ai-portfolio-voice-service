import { Router, Request, Response } from 'express';

// Single responsibility: HTTP health check only.
const router = Router();

router.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export { router as healthRouter };
