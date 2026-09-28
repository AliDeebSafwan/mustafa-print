import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import type { Pool } from 'pg';
import { generatePublicCode } from '@mpe/shared';
import { withTransaction } from '../../db/pool';
import { HttpError } from '../../http-error';
import type { AuthContext } from '../auth/types';
import type { MediaStorage } from '../media/storage';
import { detectDesignKind } from '../orders/design-files';

type Row = Record<string, unknown>;

/** A proof must open in the customer's browser, so only formats every phone can show. */
const VIEWABLE = new Set(['pdf', 'jpg', 'png']);
const CONTENT_TYPE: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png' };

const sha256Of = (path: string) => new Promise<string>((resolve, reject) => {
  const hash = createHash('sha256');
  createReadStream(path).on('data', (chunk) => hash.update(chunk)).on('end', () => resolve(hash.digest('hex'))).on('error', reject);
});

export type ProofsService = ReturnType<typeof createProofsService>;

export function createProofsService({ pool, storage, publicWebUrl }: { pool: Pool; storage: MediaStorage; publicWebUrl: string }) {
  const linkOf = (code: string) => `${publicWebUrl}/ar/proof/${code}`;

  /** Moves the order with a history row, as the server itself (the proof upload or the customer's answer did it). */
  async function moveOrder(client: { query: Pool['query'] }, order: Row, to: string, note: string, source: 'system' | 'web', userId: string | null) {
    await client.query('UPDATE orders SET status = $2 WHERE id = $1', [order.id, to]);
    await client.query(
      `INSERT INTO order_status_history (branch_id, order_id, from_status, to_status, source, note, changed_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [order.branch_id, order.id, order.status, to, source, note, userId]);
    order.status = to;
  }

  // ---- staff side ---------------------------------------------------------------------------------------------------
  async function upload(auth: AuthContext, orderId: string, file: { path: string; originalName: string; bytes: number }): Promise<Row> {
    let storedKey: string | null = null;
    try {
      const kind = await detectDesignKind(file.path);
      if (!kind || !VIEWABLE.has(kind)) throw new HttpError(400, 'invalid_request', 'unsupported_file');
      const sha256 = await sha256Of(file.path);
      const id = randomUUID();
      storedKey = `proofs/${id}.${kind}`;
      await storage.putFile(storedKey, file.path);

      return await withTransaction(pool, async (client) => {
        const { rows } = await client.query<Row>('SELECT * FROM orders WHERE id = $1 AND branch_id = $2 AND deleted_at IS NULL FOR UPDATE', [orderId, auth.branchId]);
        const order = rows[0];
        if (!order) throw new HttpError(404, 'not_found');
        if (!['received', 'in_design', 'awaiting_approval'].includes(String(order.status))) throw new HttpError(409, 'invalid_request', 'order_past_design');

        const { rows: [v] } = await client.query<{ next: number }>('SELECT coalesce(max(version), 0) + 1 AS next FROM proofs WHERE order_id = $1', [orderId]);
        // An older proof still waiting for an answer is replaced: its link now says a newer version exists.
        await client.query(`UPDATE proofs SET status = 'superseded' WHERE order_id = $1 AND status = 'pending'`, [orderId]);
        const code = generatePublicCode();
        const { rows: [proof] } = await client.query<Row>(
          `INSERT INTO proofs (id, branch_id, order_id, version, public_code, storage_key, original_name, kind, bytes, sha256, uploaded_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, version, public_code, original_name, kind, bytes, sha256, status, created_at`,
          [id, auth.branchId, orderId, v!.next, code, storedKey, file.originalName.slice(0, 200) || `proof.${kind}`, kind, file.bytes, sha256, auth.userId]);

        const note = `proof v${v!.next} sent to the customer`;
        if (order.status === 'received') await moveOrder(client, order, 'in_design', note, 'system', auth.userId);
        if (order.status === 'in_design') await moveOrder(client, order, 'awaiting_approval', note, 'system', auth.userId);
        await client.query(`UPDATE orders SET proof_status = 'pending' WHERE id = $1`, [orderId]);
        return { ...proof!, link: linkOf(code) };
      });
    } catch (err) {
      if (storedKey) await storage.remove(storedKey).catch(() => undefined);   // never keep a file for a proof that was not recorded
      throw err;
    } finally {
      await rm(file.path, { force: true });
    }
  }

  async function listForOrder(auth: AuthContext, orderId: string): Promise<Row[]> {
    const { rows } = await pool.query<Row>(
      `SELECT p.id, p.version, p.public_code, p.original_name, p.kind, p.status, p.created_at,
              coalesce(json_agg(json_build_object('decision', r.decision, 'comment', r.comment, 'responded_at', r.responded_at) ORDER BY r.responded_at)
                       FILTER (WHERE r.id IS NOT NULL), '[]') AS responses
         FROM proofs p LEFT JOIN proof_responses r ON r.proof_id = p.id
        WHERE p.order_id = $1 AND p.branch_id = $2
        GROUP BY p.id ORDER BY p.version DESC`, [orderId, auth.branchId]);
    return rows.map((r) => ({ ...r, link: linkOf(String(r.public_code)) }));
  }

  // ---- the customer's link -------------------------------------------------------------------------------------------
  async function view(code: string): Promise<Row> {
    const { rows } = await pool.query<Row>(
      `SELECT p.id, p.version, p.kind, p.status, p.created_at, o.order_number::text AS order_number, o.public_code AS order_code,
              b.name_ar AS shop_name_ar, b.name_en AS shop_name_en,
              (SELECT max(version) FROM proofs x WHERE x.order_id = p.order_id) AS latest_version
         FROM proofs p JOIN orders o ON o.id = p.order_id JOIN branches b ON b.id = p.branch_id
        WHERE p.public_code = $1`, [code]);
    const proof = rows[0];
    if (!proof) throw new HttpError(404, 'not_found');
    const responses = (await pool.query<Row>(
      'SELECT decision, comment, responded_at FROM proof_responses WHERE proof_id = $1 ORDER BY responded_at', [proof.id])).rows;
    const { id: _internal, ...visible } = proof;
    return { ...visible, isLatest: proof.version === proof.latest_version, responses };
  }

  async function fileOf(code: string): Promise<{ path: string; contentType: string }> {
    const { rows } = await pool.query<{ storage_key: string; kind: string }>('SELECT storage_key, kind FROM proofs WHERE public_code = $1', [code]);
    const path = rows[0] ? await storage.pathOf(rows[0].storage_key) : null;
    if (!rows[0] || !path) throw new HttpError(404, 'not_found');
    return { path, contentType: CONTENT_TYPE[rows[0].kind]! };
  }

  /** One answer per version, recorded forever. Asking for changes sends the job back to design. */
  async function respond(code: string, decision: 'approved' | 'changes_requested', comment: string | undefined, userAgent: string | undefined): Promise<Row> {
    return withTransaction(pool, async (client) => {
      const { rows } = await client.query<Row>('SELECT * FROM proofs WHERE public_code = $1 FOR UPDATE', [code]);
      const proof = rows[0];
      if (!proof) throw new HttpError(404, 'not_found');
      if (proof.status === 'superseded') throw new HttpError(409, 'invalid_request', 'proof_superseded');
      if (proof.status !== 'pending') throw new HttpError(409, 'invalid_request', 'proof_answered');
      const text = comment?.trim().slice(0, 2000) || null;
      if (decision === 'changes_requested' && !text) throw new HttpError(400, 'invalid_request', 'comment_required');

      await client.query(
        `INSERT INTO proof_responses (branch_id, proof_id, order_id, proof_version, file_sha256, decision, comment, user_agent)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [proof.branch_id, proof.id, proof.order_id, proof.version, proof.sha256, decision, text, userAgent?.slice(0, 300) ?? null]);
      await client.query('UPDATE proofs SET status = $2 WHERE id = $1', [proof.id, decision]);

      const { rows: [order] } = await client.query<Row>('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [proof.order_id]);
      await client.query('UPDATE orders SET proof_status = $2 WHERE id = $1', [proof.order_id, decision]);
      if (decision === 'changes_requested' && order!.status === 'awaiting_approval') {
        await moveOrder(client, order!, 'in_design', `customer asked for changes on proof v${proof.version}: ${text}`, 'web', null);
      }
      return { status: decision };
    });
  }

  return { upload, listForOrder, view, fileOf, respond };
}
