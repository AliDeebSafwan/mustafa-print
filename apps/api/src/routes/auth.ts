import { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { changeMyPasswordInput, loginRequestSchema, type SessionUser } from '@mpe/shared';
import { parseWith } from '../http-error';
import type { AuthService } from '../modules/auth/auth.service';
import { clearRefreshCookie, readCookie, REFRESH_COOKIE, setRefreshCookie } from '../modules/auth/cookies';
import { requireAllowedOrigin } from '../modules/auth/middleware';
import type { AuthConfig } from '../modules/auth/types';
import type { StaffService } from '../modules/staff/staff.service';

export function authRouter(deps: { service: AuthService; staff: StaffService; cfg: AuthConfig; allowedOrigins: readonly string[]; authenticate: RequestHandler }): Router {
  const { service, cfg } = deps;
  const router = Router();
  const ownOriginOnly = requireAllowedOrigin(deps.allowedOrigins);
  const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'too_many_attempts' } });

  router.post('/login', loginLimiter, async (req, res) => {
    const { session, refreshToken } = await service.login(parseWith(loginRequestSchema, req.body), { userAgent: req.get('user-agent') });
    setRefreshCookie(res, refreshToken, cfg);
    res.json(session);
  });

  router.post('/refresh', ownOriginOnly, async (req, res) => {
    const { session, refreshToken } = await service.refresh(readCookie(req.get('cookie'), REFRESH_COOKIE), { userAgent: req.get('user-agent') });
    setRefreshCookie(res, refreshToken, cfg);
    res.json(session);
  });

  router.post('/logout', ownOriginOnly, async (req, res) => {
    await service.logout(readCookie(req.get('cookie'), REFRESH_COOKIE));
    clearRefreshCookie(res, cfg);
    res.sendStatus(204);
  });

  router.get('/me', deps.authenticate, (req, res) => {
    const { userId, branchId, fullName, locale, role } = req.auth!;
    const user: SessionUser = { id: userId, fullName, role: role.key, branchId, locale, permissions: [...role.permissions] };
    res.json(user);
  });

  /**
   * Anyone signed in may change their own password (their current one proves who they are; no extra permission
   * needed). Every OTHER device is signed out; this one gets a fresh session so it is not.
   */
  router.post('/change-password', deps.authenticate, loginLimiter, async (req, res) => {
    const { current_password, new_password } = parseWith(changeMyPasswordInput, req.body);
    await deps.staff.changeMyPassword(req.auth!, current_password, new_password);
    const { session, refreshToken } = await service.reissueSession(req.auth!.userId, { userAgent: req.get('user-agent') });
    setRefreshCookie(res, refreshToken, cfg);
    res.json(session);
  });

  return router;
}
