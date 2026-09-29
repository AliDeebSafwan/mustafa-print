import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { customerEmailInput, customerLoginInput, customerResetInput, customerSignupInput, customerTokenInput, DESIGN_FILE_LIMIT_BYTES, PUBLIC_CODE_RE, webOrderInput } from '@mpe/shared';
import { HttpError, parseWith } from '../../http-error';
import { readCookie } from '../../modules/auth/cookies';
import { requireAllowedOrigin } from '../../modules/auth/middleware';
import type { CustomerAuthService } from '../../modules/customer-auth/customer-auth.service';
import type { WebOrderService } from '../../modules/orders/web-orders.service';

export const CUSTOMER_COOKIE = 'mpe_customer';
/** Only the account endpoints ever receive the customer's session. */
const COOKIE_PATH = '/api/v1/public/account';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Customer accounts on the website. Reached through the website's own address (Caddy in production, a Next.js rewrite
 * in development), so the session cookie is first-party. Lax, not Strict: a customer arriving from the verification
 * email must be recognised.
 */
export function customerAccountRouter(deps: { service: CustomerAuthService; orders: WebOrderService; cookieSecure: boolean; allowedOrigins: readonly string[] }): Router {
  const { service } = deps;
  const router = Router();
  const sameSite = requireAllowedOrigin(deps.allowedOrigins);
  const strict = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'too_many_attempts' } });

  const setSession = (res: Response, token: string) =>
    res.cookie(CUSTOMER_COOKIE, token, { httpOnly: true, secure: deps.cookieSecure, sameSite: 'lax', path: COOKIE_PATH, maxAge: SESSION_MS });
  const clearSession = (res: Response) => res.clearCookie(CUSTOMER_COOKIE, { httpOnly: true, secure: deps.cookieSecure, sameSite: 'lax', path: COOKIE_PATH });
  const sessionOf = (req: Request) => readCookie(req.get('cookie'), CUSTOMER_COOKIE);
  const signedIn = async (req: Request) => {
    const account = await service.accountFor(sessionOf(req));
    if (!account) throw new HttpError(401, 'unauthorized');
    return account;
  };
  const checkEmail = (res: Response) => res.status(202).json({ status: 'check_email' });

  router.post('/signup', strict, sameSite, async (req, res) => {
    await service.signup(parseWith(customerSignupInput, req.body));
    checkEmail(res);                                   // the same answer whether or not the email already had an account
  });
  router.post('/verify', sameSite, async (req, res) => {
    const token = await service.verifyEmail(parseWith(customerTokenInput, req.body).token, req.get('user-agent'));
    setSession(res, token);
    res.json(service.me((await service.accountFor(token))!));
  });
  router.post('/verify/resend', strict, sameSite, async (req, res) => {
    await service.resendVerification(parseWith(customerEmailInput, req.body).email);
    checkEmail(res);
  });
  router.post('/login', strict, sameSite, async (req, res) => {
    const { email, password } = parseWith(customerLoginInput, req.body);
    const token = await service.login(email, password, req.get('user-agent'));
    setSession(res, token);
    res.json(service.me((await service.accountFor(token))!));
  });
  router.post('/logout', sameSite, async (req, res) => {
    await service.logout(sessionOf(req));
    clearSession(res);
    res.sendStatus(204);
  });
  router.post('/password/forgot', strict, sameSite, async (req, res) => {
    await service.forgotPassword(parseWith(customerEmailInput, req.body).email);
    checkEmail(res);
  });
  router.post('/password/reset', strict, sameSite, async (req, res) => {
    const { token, password } = parseWith(customerResetInput, req.body);
    const session = await service.resetPassword(token, password, req.get('user-agent'));
    setSession(res, session);
    res.json(service.me((await service.accountFor(session))!));
  });
  // Designs can be large: written to a temporary file, never held in memory, checked, then moved into storage.
  const receiveDesign = multer({ dest: tmpdir(), limits: { fileSize: DESIGN_FILE_LIMIT_BYTES, files: 1 } }).single('file');
  const designUpload: RequestHandler = (req, res, next) => receiveDesign(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(400, 'invalid_request', 'file_too_large'));
    next(new HttpError(400, 'invalid_request', 'Send the file as multipart/form-data in a field named "file"'));
  });
  const uploads = rateLimit({ windowMs: 60 * 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'too_many_attempts' } });

  router.post('/files', uploads, sameSite, designUpload, async (req, res) => {
    if (!req.file) throw new HttpError(400, 'invalid_request', 'No file was sent');
    const account = await service.accountFor(sessionOf(req));
    if (!account) {
      await rm(req.file.path, { force: true });        // never keep an anonymous upload
      throw new HttpError(401, 'unauthorized');
    }
    res.status(201).json(await deps.orders.uploadDesign(account, { path: req.file.path, originalName: req.file.originalname, bytes: req.file.size }));
  });
  router.post('/orders', strict, sameSite, async (req, res) => {
    const account = await signedIn(req);
    res.status(201).json(await deps.orders.place(account, parseWith(webOrderInput, req.body)));
  });

  router.get('/me', async (req, res) => { res.json(service.me(await signedIn(req))); });
  router.get('/orders', async (req, res) => { res.json(await service.myOrders(await signedIn(req))); });
  router.get('/orders/:code/reorder', async (req, res) => {
    if (!PUBLIC_CODE_RE.test(req.params.code)) return void res.status(404).json({ error: 'not_found' });
    res.json(await service.reorderItems(await signedIn(req), req.params.code));
  });

  return router;
}
