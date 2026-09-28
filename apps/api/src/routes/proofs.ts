import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import { z } from 'zod';
import { PUBLIC_CODE_RE } from '@mpe/shared';
import { HttpError, parseWith } from '../http-error';
import { requirePermission } from '../modules/auth/middleware';
import type { ProofsService } from '../modules/proofs/proofs.service';

const PROOF_LIMIT_BYTES = 30 * 1024 * 1024;   // a proof is for looking at on a phone, not the print master
const uuid = z.string().uuid();
const idOf = (v: unknown) => { const r = uuid.safeParse(v); if (!r.success) throw new HttpError(404, 'not_found'); return r.data; };
const codeOf = (v: unknown) => { const code = String(v ?? '').toUpperCase(); if (!PUBLIC_CODE_RE.test(code)) throw new HttpError(404, 'not_found'); return code; };

/** Staff upload a proof for an order and see every version with the customer's answers. Online, like the order's files. */
export function adminProofsRouter(deps: { proofs: ProofsService; authenticate: RequestHandler }): Router {
  const router = Router();
  router.use(deps.authenticate);
  const receive = multer({ dest: tmpdir(), limits: { fileSize: PROOF_LIMIT_BYTES, files: 1 } }).single('file');
  const upload: RequestHandler = (req, res, next) => receive(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(400, 'invalid_request', 'file_too_large'));
    next(new HttpError(400, 'invalid_request', 'Send the file as multipart/form-data in a field named "file"'));
  });

  router.post('/:id/proofs', requirePermission('orders:update'), upload, async (req, res) => {
    if (!req.file) throw new HttpError(400, 'invalid_request', 'No file was sent');
    const orderId = z.string().uuid().safeParse(req.params.id);
    if (!orderId.success) { await rm(req.file.path, { force: true }); throw new HttpError(404, 'not_found'); }
    res.status(201).json(await deps.proofs.upload(req.auth!, orderId.data, { path: req.file.path, originalName: req.file.originalname, bytes: req.file.size }));
  });
  router.get('/:id/proofs', requirePermission('orders:read'), async (req, res) => {
    res.json(await deps.proofs.listForOrder(req.auth!, idOf(req.params.id)));
  });
  return router;
}

/** The customer's link: view the proof, open the file, and answer once. */
export function publicProofsRouter(deps: { proofs: ProofsService }): Router {
  const router = Router();
  router.use(rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'too_many_attempts' } }));
  router.get('/:code', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await deps.proofs.view(codeOf(req.params.code)));
  });
  router.get('/:code/file', async (req, res) => {
    const file = await deps.proofs.fileOf(codeOf(req.params.code));
    // Shown inline (the customer is meant to look at it), but never sniffed into anything else.
    res.sendFile(file.path, { headers: { 'Content-Type': file.contentType, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'", 'Cross-Origin-Resource-Policy': 'cross-origin' } });
  });
  router.post('/:code/respond', async (req, res) => {
    const body = parseWith(z.object({ decision: z.enum(['approved', 'changes_requested']), comment: z.string().max(2000).optional() }), req.body ?? {});
    res.json(await deps.proofs.respond(codeOf(req.params.code), body.decision, body.comment, req.get('user-agent')));
  });
  return router;
}
