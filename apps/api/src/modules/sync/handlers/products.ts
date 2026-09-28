import { applyPatch, requirePermission, type DbRow } from './common';
import { MutationRejected, type Handler, type HandlerContext } from './types';

const DEFAULTS = { category: 'general', unit: 'piece', pricing_model: 'per_unit', base_price: '0', min_quantity: '1', sort_order: 0 };

/**
 * The shop's catalogue. Prices live here as `numeric`, and the tiers ("500 or more cost 0.04 each") as JSON the
 * shared pricing function reads on both sides, so a device and the server always quote the same price.
 */
export const insertProduct: Handler<'products:insert'> = async (ctx, { entityId, payload: p }) => {
  requirePermission(ctx, 'products:write');
  const { client, auth } = ctx;

  const inserted = await client.query<DbRow>(
    `INSERT INTO products (id, branch_id, sku, name_ar, name_en, description_ar, description_en, category, unit, pricing_model,
                           base_price, min_quantity, price_rules, is_active, is_public, sort_order, cover_media_id, service_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, round($11::numeric, 4), round($12::numeric, 3), $13::jsonb, $14, $15, $16, $17, $18)
     ON CONFLICT (id) DO NOTHING RETURNING *`,
    [entityId, auth.branchId, p.sku, p.name_ar, p.name_en, p.description_ar ?? null, p.description_en ?? null,
     p.category ?? DEFAULTS.category, p.unit ?? DEFAULTS.unit, p.pricing_model ?? DEFAULTS.pricing_model,
     p.base_price ?? DEFAULTS.base_price, p.min_quantity ?? DEFAULTS.min_quantity, JSON.stringify(p.price_rules ?? []),
     p.is_active ?? true, p.is_public ?? false, p.sort_order ?? DEFAULTS.sort_order, p.cover_media_id ?? null, p.service_id ?? null]);
  if (inserted.rows[0]) {
    await assertPublicPictureDescribed(ctx, inserted.rows[0]);
    return { row: inserted.rows[0] };
  }

  // The same product sent twice: nothing to change, as long as it is ours.
  const { rows } = await client.query<DbRow>('SELECT * FROM products WHERE id = $1 AND branch_id = $2', [entityId, auth.branchId]);
  if (!rows[0]) throw new MutationRejected('id_in_use');
  return { row: rows[0] };
};

export const updateProduct: Handler<'products:update'> = async (ctx, { entityId, payload: { changes, base } }) => {
  requirePermission(ctx, 'products:write');
  const row = await applyPatch(ctx, { table: 'products', id: entityId, changes, base });
  await assertPublicPictureDescribed(ctx, row);
  return { row };
};

/**
 * The website rule, the same as for services and the showroom: nothing is shown with a picture nobody described.
 * Runs after the write, inside the mutation's savepoint, so a refusal undoes the write.
 */
async function assertPublicPictureDescribed(ctx: HandlerContext, row: DbRow): Promise<void> {
  if (!row.is_public || !row.cover_media_id) return;
  const { rows } = await ctx.client.query<{ alt_ar: string | null }>(
    'SELECT alt_ar FROM media WHERE id = $1 AND branch_id = $2 AND deleted_at IS NULL', [row.cover_media_id, ctx.auth.branchId]);
  if (!rows[0]?.alt_ar?.trim()) throw new MutationRejected('missing_alt_text', 'describe the picture before showing the product on the website');
}
