import { enqueueManualMessage } from '../../messaging/enqueue';
import { lockOrder, requirePermission } from './common';
import { MutationRejected, type Handler } from './types';

/**
 * Manual sends one person may queue per hour. This is the only mutation that spends real money per call (WhatsApp is
 * billed per message), and a 15-minute access token is enough to queue thousands: one push may carry 200 mutations, so
 * a limit on sync REQUESTS would not bound the spend at all. The cost belongs where the cost is incurred.
 *
 * Sixty is far above a counter's real use — messaging a customer by hand is a few times an hour at most — and it is
 * per person, so one compromised account cannot spend on behalf of the shop.
 */
const MANUAL_SENDS_PER_HOUR = 60;

/**
 * A message staff typed themselves, not triggered by a status change. Consent is re-checked on the server
 * regardless of what the device believed offline — the customer's opt-in may have changed since.
 */
export const sendManualMessage: Handler<'notification_logs:manual_send'> = async (ctx, { entityId, payload: p }) => {
  requirePermission(ctx, 'notifications:send');
  const { client, auth } = ctx;

  // Counted on queued_at, not created_at: a batch that waited in a device's outbox all day is the shop's real work and
  // must still go out. What this stops is the same person queueing them faster than any human could have typed them.
  const { rows: [recent] } = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM notification_logs
      WHERE created_by = $1 AND trigger = 'manual' AND queued_at > clock_timestamp() - interval '1 hour'`, [auth.userId]);
  if (recent!.n >= MANUAL_SENDS_PER_HOUR) {
    throw new MutationRejected('too_many_messages', `at most ${MANUAL_SENDS_PER_HOUR} messages an hour per person`);
  }

  // Like every other handler that acts on an order: scopes it to the caller's branch and locks the row.
  await lockOrder(ctx, p.order_id);

  const result = await enqueueManualMessage(client, entityId, p.order_id, { channel: p.channel, body: p.body, createdBy: auth.userId, branchId: auth.branchId });
  if (result.reason === 'order_not_found') throw new MutationRejected('order_not_found');
  if (result.reason === 'no_consented_channel') throw new MutationRejected('no_consented_channel', `the customer has not consented to ${p.channel}`);

  const { rows } = await client.query('SELECT * FROM notification_logs WHERE id = $1', [entityId]);
  return { row: rows[0] };
};
