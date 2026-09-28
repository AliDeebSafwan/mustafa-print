import { enqueueManualMessage } from '../../messaging/enqueue';
import { requirePermission } from './common';
import { MutationRejected, type Handler } from './types';

/**
 * A message staff typed themselves, not triggered by a status change. Consent is re-checked on the server
 * regardless of what the device believed offline — the customer's opt-in may have changed since.
 */
export const sendManualMessage: Handler<'notification_logs:manual_send'> = async (ctx, { entityId, payload: p }) => {
  requirePermission(ctx, 'notifications:send');
  const { client, auth } = ctx;

  const result = await enqueueManualMessage(client, entityId, p.order_id, { channel: p.channel, body: p.body, createdBy: auth.userId });
  if (result.reason === 'order_not_found') throw new MutationRejected('order_not_found');
  if (result.reason === 'no_consented_channel') throw new MutationRejected('no_consented_channel', `the customer has not consented to ${p.channel}`);

  const { rows } = await client.query('SELECT * FROM notification_logs WHERE id = $1', [entityId]);
  return { row: rows[0] };
};
