import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { CONTENT_STATUSES, MEDIA_LIMITS, mediaMetaInput } from '@mpe/shared';
import { HttpError, parseWith } from '../http-error';
import { requirePermission } from '../modules/auth/middleware';
import { publicMediaPath, type ContentService } from '../modules/content/content.service';
import { ImageRejected, processImage } from '../modules/media/images';

const idParam = z.string().uuid();
const versionBody = z.object({ row_version: z.number().int().positive() });
const statusBody = versionBody.extend({ status: z.enum(CONTENT_STATUSES) });
const saveBody = z.object({ row_version: z.number().int().positive().optional(), data: z.unknown() });

const idOf = (value: unknown): string => {
  const parsed = idParam.safeParse(value);
  if (!parsed.success) throw new HttpError(404, 'not_found');
  return parsed.data;
};

/** Pictures come back with the addresses the admin screens show them from. */
const withUrls = (row: Record<string, unknown>) => ({
  ...row,
  srcset: ((row.variants as { width: number; key: string }[]) ?? []).map((v) => ({ width: v.width, src: publicMediaPath(v.key) })),
});

/**
 * Everything the owner edits on the website. Online only: this is office work, and pictures need a connection anyway.
 * Only `content:manage` may use it, which in this shop means the owner.
 */
export function adminContentRouter(deps: { content: ContentService; authenticate: RequestHandler }): Router {
  const { content } = deps;
  const router = Router();
  router.use(deps.authenticate, requirePermission('content:manage'));

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MEDIA_LIMITS.maxBytes, files: 1 } }).single('file');
  const receiveFile: RequestHandler = (req, res, next) => upload(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(400, 'invalid_image', 'too_large'));
    next(new HttpError(400, 'invalid_request', 'Send the picture as multipart/form-data in a field named "file"'));
  });

  // ---- pictures ----
  router.get('/media', async (req, res) => { res.json((await content.listMedia(req.auth!)).map(withUrls)); });

  router.post('/media', receiveFile, async (req, res) => {
    if (!req.file) throw new HttpError(400, 'invalid_request', 'No picture was sent');
    try {
      const image = await processImage(req.file.buffer);
      res.status(201).json(withUrls(await content.createMedia(req.auth!, image, req.file.originalname)));
    } catch (err) {
      if (err instanceof ImageRejected) throw new HttpError(400, 'invalid_image', err.code);
      throw err;
    }
  });

  router.patch('/media/:id', async (req, res) => {
    res.json(withUrls(await content.updateMediaMeta(req.auth!, idOf(req.params.id), parseWith(mediaMetaInput, req.body))));
  });

  router.delete('/media/:id', async (req, res) => {
    await content.deleteMedia(req.auth!, idOf(req.params.id));
    res.sendStatus(204);
  });

  // ---- services and showroom share one shape: list, create, save a version, publish/hide, delete ----
  const collection = (path: string, ops: {
    list: ContentService['listServices'];
    save: ContentService['saveService'];
    setStatus: ContentService['setServiceStatus'];
    remove: ContentService['deleteService'];
  }) => {
    router.get(path, async (req, res) => { res.json(await ops.list(req.auth!)); });
    router.post(path, async (req, res) => { res.status(201).json(await ops.save(req.auth!, null, parseWith(saveBody, req.body).data)); });
    router.put(`${path}/:id`, async (req, res) => {
      const body = parseWith(saveBody, req.body);
      if (!body.row_version) throw new HttpError(400, 'invalid_request', 'row_version is required to save a change');
      res.json(await ops.save(req.auth!, idOf(req.params.id), body.data, body.row_version));
    });
    router.post(`${path}/:id/status`, async (req, res) => {
      const body = parseWith(statusBody, req.body);
      res.json(await ops.setStatus(req.auth!, idOf(req.params.id), body.status, body.row_version));
    });
    router.delete(`${path}/:id`, async (req, res) => {
      const body = parseWith(versionBody, { row_version: Number(req.query.row_version) });
      await ops.remove(req.auth!, idOf(req.params.id), body.row_version);
      res.sendStatus(204);
    });
  };
  collection('/services', { list: content.listServices, save: content.saveService, setStatus: content.setServiceStatus, remove: content.deleteService });
  collection('/gallery', { list: content.listGallery, save: content.saveGalleryItem, setStatus: content.setGalleryStatus, remove: content.deleteGalleryItem });

  // ---- the shop's details ----
  router.get('/settings', async (req, res) => { res.json(await content.getSettings(req.auth!.branchId)); });
  router.put('/settings', async (req, res) => {
    const body = parseWith(saveBody, req.body);
    if (!body.row_version) throw new HttpError(400, 'invalid_request', 'row_version is required to save a change');
    res.json(await content.saveSettings(req.auth!, body.data, body.row_version));
  });

  return router;
}
