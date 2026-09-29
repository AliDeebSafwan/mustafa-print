import { Router, type RequestHandler } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { extractVariables, templateEditInput, templateProblems } from '@mpe/shared';
import { HttpError, parseWith } from '../../http-error';
import { requirePermission } from '../../modules/auth/middleware';

type Row = Record<string, unknown> & { variables: string[]; channel: string; provider_template_name: string | null };

const saveBody = z.object({ row_version: z.number().int().positive(), data: z.unknown() });

/**
 * The words customers receive. Edited online by the owner only (`notifications:templates:write`); devices receive the
 * result on their next sync. See templateProblems for why WhatsApp edits are stricter than SMS or email.
 */
export function adminTemplatesRouter(deps: { pool: Pool; authenticate: RequestHandler }): Router {
  const { pool } = deps;
  const router = Router();
  router.use(deps.authenticate);

  router.get('/', requirePermission('notifications:templates:read'), async (req, res) => {
    const { rows } = await pool.query(
      `SELECT * FROM notification_templates WHERE branch_id = $1 AND deleted_at IS NULL ORDER BY template_key, channel, locale`, [req.auth!.branchId]);
    res.json(rows);
  });

  router.put('/:id', requirePermission('notifications:templates:write'), async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) throw new HttpError(404, 'not_found');
    const { row_version, data } = parseWith(saveBody, req.body);
    const edit = parseWith(templateEditInput, data);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<Row>(
        'SELECT * FROM notification_templates WHERE id = $1 AND branch_id = $2 AND deleted_at IS NULL FOR UPDATE', [id.data, req.auth!.branchId]);
      const current = rows[0];
      if (!current) throw new HttpError(404, 'not_found');
      if (Number(current.row_version) !== row_version) throw new HttpError(409, 'version_conflict', 'Someone saved a newer version meanwhile');

      const problems = templateProblems(current, edit);
      if (problems.length > 0) throw new HttpError(400, 'invalid_request', problems.map((p) => p.code).join(','));

      // The variable list is the order WhatsApp fills an approved template's placeholders in; it follows the new text
      // only when the approval changes too (templateProblems guarantees they agree otherwise).
      const variables = extractVariables(edit.body);
      const { rows: saved } = await client.query(
        `UPDATE notification_templates
            SET body = $3, subject = $4, variables = $5, is_active = coalesce($6, is_active),
                provider_template_name = CASE WHEN $7 THEN $8 ELSE provider_template_name END
          WHERE id = $1 AND branch_id = $2 RETURNING *`,
        [id.data, req.auth!.branchId, edit.body, edit.subject ?? null, variables, edit.is_active ?? null,
         edit.provider_template_name !== undefined, edit.provider_template_name ?? null]);
      await client.query('COMMIT');
      res.json(saved[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  return router;
}
