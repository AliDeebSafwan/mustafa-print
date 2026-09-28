import type { Pool } from 'pg';
import type { Logger } from '../../logger';
import type { ChannelProvider } from '../messaging/types';
import { createReportsService } from './reports.service';

export interface SummaryFigures {
  date: string; currency: string; shopName: string;
  ordersPlaced: number; revenuePlaced: string; ordersCompleted: number; cashIn: string; cashOut: string;
  ordersDueToday: number; overdueOrders: number; unpaidCount: number; unpaidTotal: string;
}

const money = (v: string, currency: string) => `${Number(v).toFixed(2)} ${currency}`;

/** Plain text on purpose: it reads the same in every mail app, and nothing in it needs to be trusted as markup. */
export function renderSummary(f: SummaryFigures): { subject: string; body: string } {
  const lines = [
    `ملخص يوم ${f.date} — ${f.shopName}`,
    '',
    `الطلبات الواردة: ${f.ordersPlaced} (بقيمة ${money(f.revenuePlaced, f.currency)})`,
    `الطلبات المُسلَّمة: ${f.ordersCompleted}`,
    `النقد الداخل للصندوق: ${money(f.cashIn, f.currency)}${Number(f.cashOut) > 0 ? ` — مسترد: ${money(f.cashOut, f.currency)}` : ''}`,
    '',
    `مستحقة التسليم اليوم ولم تُسلَّم: ${f.ordersDueToday}`,
    `متأخرة عن موعدها: ${f.overdueOrders}`,
    `ذمم غير مسدَّدة: ${f.unpaidCount} طلب بإجمالي ${money(f.unpaidTotal, f.currency)}`,
    '',
    'تصلك هذه الرسالة لأن عنوانك مسجَّل لملخص المالك اليومي. لتغيير العنوان أو الساعة أو الإيقاف: الإعدادات ← الطاقم ← الإعدادات.',
  ];
  return { subject: `ملخص اليوم — ${f.shopName} — ${f.date}`, body: lines.join('\n') };
}

/**
 * The owner's end-of-day email. A day is CLAIMED by moving branches.summary_last_date forward in a single statement
 * (rows already claimed are skipped, and locked ones are left to whoever holds them), so two workers, or a restart
 * mid-tick, can never send the same day twice. A failed send gives the day back, to be tried again on a later tick.
 */
export function createDailySummaryService({ pool, mailer, log }: { pool: Pool; mailer: ChannelProvider; log: Logger }) {
  const reports = createReportsService({ pool });
  const lastFailedAt = new Map<string, number>();
  const RETRY_AFTER_MS = 15 * 60 * 1000;

  async function figuresFor(branchId: string, date: string, shopName: string, currency: string): Promise<SummaryFigures> {
    const [day, unpaid, queue] = await Promise.all([reports.dashboard({ branchId }, date), reports.unpaidBalances({ branchId }), reports.productionQueue({ branchId })]);
    const unpaidCents = unpaid.reduce((sum, r) => sum + Math.round(Number(r.remaining) * 100), 0);
    const now = Date.now();
    return {
      date, currency, shopName,
      ordersPlaced: Number(day.ordersPlaced), revenuePlaced: String(day.revenuePlaced), ordersCompleted: Number(day.ordersCompleted),
      cashIn: String(day.cashIn), cashOut: String(day.cashOut), ordersDueToday: Number(day.ordersDueToday),
      overdueOrders: queue.filter((o) => o.due_at && new Date(String(o.due_at)).getTime() < now).length,
      unpaidCount: unpaid.length, unpaidTotal: (unpaidCents / 100).toFixed(2),
    };
  }

  /** Sends to every branch whose hour has come and whose day has not gone out yet. Returns how many went out. */
  async function sendDue(): Promise<number> {
    const { rows: claimed } = await pool.query<{ id: string; email: string; name: string; currency: string; date: string; prev: string | null }>(
      `WITH due AS (
         SELECT id, summary_last_date AS prev FROM branches
          WHERE summary_email IS NOT NULL AND deleted_at IS NULL
            AND extract(hour FROM now() AT TIME ZONE timezone) >= summary_hour
            AND (summary_last_date IS NULL OR summary_last_date < (now() AT TIME ZONE timezone)::date)
          FOR UPDATE SKIP LOCKED)
       UPDATE branches b SET summary_last_date = (now() AT TIME ZONE b.timezone)::date
         FROM due WHERE b.id = due.id
       RETURNING b.id, b.summary_email AS email, b.name_ar AS name, b.base_currency AS currency, b.summary_last_date::text AS date, due.prev::text AS prev`);

    let sent = 0;
    for (const b of claimed) {
      const giveBack = () => pool.query('UPDATE branches SET summary_last_date = $2 WHERE id = $1', [b.id, b.prev]);
      const lastFailure = lastFailedAt.get(b.id) ?? 0;
      if (Date.now() - lastFailure < RETRY_AFTER_MS) { await giveBack(); continue; }   // failed a moment ago: wait, do not hammer the mail service
      try {
        const { subject, body } = renderSummary(await figuresFor(b.id, b.date, b.name, b.currency));
        const result = await mailer.send({ logId: `daily-summary-${b.id}-${b.date}`, channel: 'email', to: b.email, locale: 'ar', subject, body });
        if (!result.ok) throw new Error(`mail provider refused: ${result.message}`);
        lastFailedAt.delete(b.id);
        sent++;
      } catch (err) {
        lastFailedAt.set(b.id, Date.now());
        log.error({ err, branch: b.id }, 'daily summary failed; will retry');
        await giveBack();
      }
    }
    return sent;
  }

  return { figuresFor, sendDue };
}
