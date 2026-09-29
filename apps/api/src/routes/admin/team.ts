import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { branchSettingsInput, resetPasswordInput, staffCreateInput, staffUpdateInput } from '@mpe/shared';
import { HttpError, parseWith } from '../../http-error';
import { requirePermission } from '../../modules/auth/middleware';
import type { StaffService } from '../../modules/staff/staff.service';

const uuid = z.string().uuid();
const idOf = (v: unknown) => { const r = uuid.safeParse(v); if (!r.success) throw new HttpError(404, 'not_found'); return r.data; };
const versioned = z.object({ row_version: z.number().int().positive(), data: z.unknown() });

/**
 * The owner's tools for the team and the shop's business rules. Every route requires `users:manage` or
 * `settings:manage` — permissions no role ever grants to itself and the owner can never delegate away (they are not
 * on TOGGLEABLE_PERMISSIONS), so only an admin ever reaches this router.
 */
export function adminTeamRouter(deps: { staff: StaffService; authenticate: RequestHandler; onPublicChange?: () => void }): Router {
  const { staff } = deps;
  const router = Router();
  router.use(deps.authenticate);

  router.get('/users', requirePermission('users:manage'), async (req, res) => { res.json(await staff.listUsers(req.auth!)); });

  router.post('/users', requirePermission('users:manage'), async (req, res) => {
    res.status(201).json(await staff.createUser(req.auth!, parseWith(staffCreateInput, req.body)));
  });

  router.put('/users/:id', requirePermission('users:manage'), async (req, res) => {
    const body = parseWith(versioned, req.body);
    res.json(await staff.updateUser(req.auth!, idOf(req.params.id), parseWith(staffUpdateInput, body.data), body.row_version));
  });

  router.post('/users/:id/reset-password', requirePermission('users:manage'), async (req, res) => {
    await staff.resetPassword(req.auth!, idOf(req.params.id), parseWith(resetPasswordInput, req.body).password);
    res.sendStatus(204);
  });

  router.post('/users/:id/end-sessions', requirePermission('users:manage'), async (req, res) => {
    await staff.endSessions(req.auth!, idOf(req.params.id));
    res.sendStatus(204);
  });

  router.get('/audit-log', requirePermission('users:manage'), async (req, res) => {
    const before = typeof req.query.before === 'string' ? req.query.before : undefined;
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
    res.json(await staff.auditLog(req.auth!, { before, limit }));
  });

  router.get('/branch-settings', requirePermission('settings:manage'), async (req, res) => { res.json(await staff.getBranchSettings(req.auth!)); });

  router.put('/branch-settings', requirePermission('settings:manage'), async (req, res) => {
    const body = parseWith(versioned, req.body);
    const saved = await staff.saveBranchSettings(req.auth!, parseWith(branchSettingsInput, body.data), body.row_version);
    deps.onPublicChange?.();   // the registered name appears on the website's legal pages
    res.json(saved);
  });

  return router;
}
