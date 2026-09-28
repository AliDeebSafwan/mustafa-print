import { hasPermission } from '@mpe/shared';
import { applyPatch, assertIdIsOurs, requirePermission, type DbRow } from './common';
import { MutationConflict, MutationRejected, type Handler } from './types';

export const insertCustomer: Handler<'customers:insert'> = async (ctx, { entityId, payload: p }) => {
  requirePermission(ctx, 'customers:write');
  const { client, auth } = ctx;
  if (p.credit_limit !== undefined && p.credit_limit !== null && !hasPermission(auth.role.permissions, 'customers:credit:manage')) {
    throw new MutationRejected('forbidden', 'only a manager may set a credit limit');
  }

  if (p.phone_e164) {
    // Two offline devices can register the same person. Hand the existing customer back so the shop merges, not duplicates.
    const { rows } = await client.query<DbRow>(
      'SELECT * FROM customers WHERE branch_id = $1 AND phone_e164 = $2 AND deleted_at IS NULL AND id <> $3', [auth.branchId, p.phone_e164, entityId]);
    if (rows[0]) throw new MutationConflict('phone_already_registered', rows[0], 'customers');
  }

  const optedIn = Boolean(p.whatsapp_opt_in || p.sms_opt_in || p.email_opt_in);
  const inserted = await client.query<DbRow>(
    `INSERT INTO customers (id, branch_id, customer_type, full_name, company_name, phone_e164, email, address_line, city, country_code,
                            locale, whatsapp_opt_in, sms_opt_in, email_opt_in, preferred_channel, consent_recorded_at, consent_source, notes,
                            tax_number, credit_limit)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, CASE WHEN $16::boolean THEN clock_timestamp() END, $17,$18,$19,$20)
     ON CONFLICT (id) DO NOTHING RETURNING *`,
    [entityId, auth.branchId, p.customer_type ?? 'b2c', p.full_name, p.company_name ?? null, p.phone_e164 ?? null, p.email ?? null,
     p.address_line ?? null, p.city ?? null, p.country_code ?? null, p.locale ?? 'ar', p.whatsapp_opt_in ?? false, p.sms_opt_in ?? false,
     p.email_opt_in ?? false, p.preferred_channel ?? 'whatsapp', optedIn, optedIn ? p.consent_source : null, p.notes ?? null,
     p.tax_number ?? null, p.credit_limit ?? null]);

  if (inserted.rows[0]) return { row: inserted.rows[0] };
  await assertIdIsOurs(ctx, 'customers', entityId);                // same customer sent again: nothing to change
  const { rows } = await client.query<DbRow>('SELECT * FROM customers WHERE id = $1', [entityId]);
  return { row: rows[0] };
};

export const updateCustomer: Handler<'customers:update'> = async (ctx, { entityId, payload: { changes, base } }) => {
  requirePermission(ctx, 'customers:write');
  if ('credit_limit' in changes && !hasPermission(ctx.auth.role.permissions, 'customers:credit:manage')) {
    throw new MutationRejected('forbidden', 'only a manager may change a credit limit');
  }
  const optsIn = Boolean(changes.whatsapp_opt_in || changes.sms_opt_in || changes.email_opt_in);
  const row = await applyPatch(ctx, {
    table: 'customers', id: entityId, changes, base,
    extraAssignments: optsIn ? ['consent_recorded_at = clock_timestamp()'] : [],     // consent is timestamped by the server
  });
  return { row };
};
