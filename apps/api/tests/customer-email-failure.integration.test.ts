import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCustomerAuthService } from '../src/modules/customer-auth/customer-auth.service';
import { createTestDatabase, hasTestDatabase, type TestDatabase } from './helpers/test-db';
import { seedFixtures } from './helpers/test-server';

/** A provider that refuses every email the way Resend does with an unverified sender: a result, not an error. */
const refusingMailer = {
  channel: 'email' as const, name: 'refusing',
  async send() { return { ok: false as const, provider: 'resend', retryable: false, code: 'validation_error', message: 'The domain is not verified' }; },
};

describe.skipIf(!hasTestDatabase)('customer account email that the provider refuses', () => {
  let db: TestDatabase;
  beforeAll(async () => { db = await createTestDatabase(); await seedFixtures(db.pool); });
  afterAll(async () => { await db.drop(); });

  it('is logged with the provider\'s reason (never the one-time link), and sign-up still answers as usual', async () => {
    const errors: { obj: Record<string, unknown>; msg: string }[] = [];
    const log = { error: (obj: Record<string, unknown>, msg: string) => { errors.push({ obj, msg }); } };
    const service = createCustomerAuthService({ pool: db.pool, mailer: refusingMailer, siteUrl: 'https://print.example.com', branchCode: 'MAIN', log: log as never });

    await expect(service.signup({ email: 'refused@example.com', password: 'a good long password', full_name: 'Layla', locale: 'en' } as never)).resolves.toBeUndefined();

    expect(errors).toEqual([{ msg: 'customer account email was not sent', obj: { kind: 'verify', provider: 'resend', code: 'validation_error', reason: 'The domain is not verified' } }]);
    expect(JSON.stringify(errors)).not.toContain('token=');
  });
});
