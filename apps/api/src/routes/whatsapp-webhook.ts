import { createHmac, timingSafeEqual } from 'node:crypto';
import express, { Router } from 'express';
import type { Pool } from 'pg';
import type { Logger } from 'pino';

export function verifyMetaSignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const given = Buffer.from(header.slice('sha256='.length), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

interface WaStatus {
  id: string;
  status: string;
  timestamp?: string;
  errors?: { code?: number; title?: string; message?: string }[];
}

export function extractStatuses(body: unknown): WaStatus[] {
  const out: WaStatus[] = [];
  const entries = (body as { entry?: { changes?: { value?: { statuses?: WaStatus[] } }[] }[] } | null)?.entry ?? [];
  for (const entry of entries) for (const change of entry.changes ?? []) for (const s of change.value?.statuses ?? []) if (s?.id && s.status) out.push(s);
  return out;
}

/** Only moves a message forward (sent -> delivered -> read); never downgrades, never resurrects. */
export async function applyStatus(pool: Pool, s: WaStatus): Promise<void> {
  const at = s.timestamp && /^\d+$/.test(s.timestamp) ? new Date(Number(s.timestamp) * 1000) : new Date();
  const where = `provider = 'whatsapp_cloud' AND provider_message_id = $1`;
  if (s.status === 'delivered') {
    await pool.query(`UPDATE notification_logs SET status = 'delivered', delivered_at = $2 WHERE ${where} AND status IN ('sending','sent')`, [s.id, at]);
  } else if (s.status === 'read') {
    await pool.query(`UPDATE notification_logs SET status = 'read', read_at = $2, delivered_at = coalesce(delivered_at, $2) WHERE ${where} AND status IN ('sending','sent','delivered')`, [s.id, at]);
  } else if (s.status === 'failed') {
    const err = s.errors?.[0];
    await pool.query(
      `UPDATE notification_logs SET status = 'failed', failed_at = $2, error_code = $3, error_message = $4 WHERE ${where} AND status IN ('sending','sent')`,
      [s.id, at, err?.code != null ? String(err.code) : null, err?.message ?? err?.title ?? 'delivery failed'],
    );
  }
}

/** Mount BEFORE express.json(): signature verification needs the raw bytes. */
export function whatsappWebhookRouter(deps: { pool: Pool; log: Logger; appSecret?: string; verifyToken?: string }): Router {
  const r = Router();

  // Meta's one-time subscription handshake.
  r.get('/whatsapp', (req, res) => {
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query as Record<string, string | undefined>;
    if (deps.verifyToken && mode === 'subscribe' && token === deps.verifyToken && challenge) return void res.status(200).type('text/plain').send(challenge);
    res.sendStatus(403);
  });

  r.post('/whatsapp', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
    if (!deps.appSecret) return void res.sendStatus(404);
    const raw = req.body as Buffer;
    if (!Buffer.isBuffer(raw) || !verifyMetaSignature(raw, req.header('x-hub-signature-256'), deps.appSecret)) return void res.sendStatus(401);
    try {
      for (const s of extractStatuses(JSON.parse(raw.toString('utf8')))) await applyStatus(deps.pool, s);
    } catch (err) {
      deps.log.error({ err }, 'whatsapp webhook processing failed');
      return void res.sendStatus(500);   // Meta retries
    }
    res.sendStatus(200);
  });

  return r;
}
