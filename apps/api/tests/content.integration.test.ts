import { readdir } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDatabase } from './helpers/test-db';
import { mutation, newId, pushOne } from './helpers/sync-client';
import { jsonOf, startTestServer, type ApiClient, type TestServer } from './helpers/test-server';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** A phone-style photo: JPEG, with the GPS position of where it was taken written into its metadata. */
const photoWithLocation = (width = 2400, height = 1600) =>
  sharp({ create: { width, height, channels: 3, background: '#2a6' } })
    .withExif({ IFD0: { Make: 'TestPhone', Model: 'X' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '34/1 21/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '36/1 23/1 0/1' } })
    .jpeg().toBuffer();

describe.skipIf(!hasTestDatabase)('website content', () => {
  let s: TestServer;
  let admin: ApiClient, reception: ApiClient, otherAdmin: ApiClient;

  // A stand-in for the website, to check it is told when to refresh.
  let site: Server;
  const refreshes: string[] = [];

  beforeAll(async () => {
    site = await new Promise<Server>((resolve) => {
      const server = createServer((req, res) => { refreshes.push(String(req.headers.authorization)); res.end('ok'); });
      server.listen(0, '127.0.0.1', () => resolve(server));
    });
    const sitePort = (site.address() as AddressInfo).port;
    s = await startTestServer({ WEB_REVALIDATE_URL: `http://127.0.0.1:${sitePort}/api/revalidate`, WEB_REVALIDATE_SECRET: 'test-revalidate-secret-0123456789' });
    admin = await s.as('admin');
    reception = await s.as('receptionist');
    otherAdmin = await s.as('otheradmin');
  });
  afterAll(async () => { await s.close(); await new Promise<void>((r) => site.close(() => r())); });

  const api = (client: ApiClient) => ({
    get: (p: string) => client.get(`/api/v1/admin/content${p}`),
    post: (p: string, body: unknown) => client.post(`/api/v1/admin/content${p}`, body),
    put: (p: string, body: unknown) => fetch(`${s.baseUrl}/api/v1/admin/content${p}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${client.token}` }, body: JSON.stringify(body) }),
    patch: (p: string, body: unknown) => fetch(`${s.baseUrl}/api/v1/admin/content${p}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${client.token}` }, body: JSON.stringify(body) }),
    del: (p: string) => fetch(`${s.baseUrl}/api/v1/admin/content${p}`, { method: 'DELETE', headers: { Authorization: `Bearer ${client.token}` } }),
  });
  const upload = async (client: ApiClient, data: Buffer, name = 'photo.jpg', type = 'image/jpeg') => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(data)], { type }), name);
    return fetch(`${s.baseUrl}/api/v1/admin/content/media`, { method: 'POST', headers: { Authorization: `Bearer ${client.token}` }, body: form });
  };
  const uploaded = async (alt?: string) => {
    const media = await jsonOf(await upload(admin, await photoWithLocation(1200, 800)));
    if (alt) await api(admin).patch(`/media/${media.id}`, { alt_ar: alt });
    return media;
  };
  const publicGet = (p: string) => fetch(`${s.baseUrl}/api/v1/public/site${p}`);

  describe('pictures', () => {
    it('keeps a private original and serves resized copies, with the location removed from all of them', async () => {
      const res = await upload(admin, await photoWithLocation());
      expect(res.status).toBe(201);
      const media = await jsonOf(res);
      expect(media).toMatchObject({ mime_type: 'image/jpeg', width: 2400, height: 1600, original_name: 'photo.jpg', alt_ar: null });
      expect(media.srcset.map((v: Json) => v.width)).toEqual([480, 800, 1200, 1600]);

      const original = await readdir(path.join(s.mediaDir, 'originals'));
      expect((await sharp(path.join(s.mediaDir, 'originals', original[0]!)).metadata()).exif).toBeUndefined();

      const served = await fetch(`${s.baseUrl}${media.srcset[0].src}`);
      expect(served.status).toBe(200);
      expect(served.headers.get('content-type')).toBe('image/webp');
      expect(served.headers.get('cache-control')).toContain('immutable');
      expect(served.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
      const bytes = Buffer.from(await served.arrayBuffer());
      const meta = await sharp(bytes).metadata();
      expect(meta.width).toBe(480);
      expect(meta.exif).toBeUndefined();
    });

    it('never enlarges a small picture and never serves an original or a made-up path', async () => {
      const media = await jsonOf(await upload(admin, await photoWithLocation(700, 500)));
      expect(media.srcset.map((v: Json) => v.width)).toEqual([480, 700]);
      const originalName = path.basename(String(media.storage_key));
      expect((await fetch(`${s.baseUrl}/api/v1/public/site/media/${originalName}`)).status).toBe(404);
      expect((await fetch(`${s.baseUrl}/api/v1/public/site/media/..%2F..%2Fetc%2Fpasswd`)).status).toBe(404);
    });

    it('reads the real format from the file, not from what the browser claims', async () => {
      const text = await upload(admin, Buffer.from('not a picture at all'), 'evil.jpg', 'image/jpeg');
      expect(text.status).toBe(400);
      expect(await jsonOf(text)).toMatchObject({ error: 'invalid_image', message: 'not_an_image' });

      const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } }).gif().toBuffer();
      expect(await jsonOf(await upload(admin, gif, 'a.gif', 'image/gif'))).toMatchObject({ error: 'invalid_image', message: 'unsupported_format' });

      const png = await upload(admin, await sharp({ create: { width: 600, height: 400, channels: 4, background: '#0000' } }).png().toBuffer(), 'logo.png', 'image/png');
      expect(png.status).toBe(201);
    });

    it('refuses a file over the size limit', async () => {
      const res = await upload(admin, Buffer.alloc(16 * 1024 * 1024, 1));
      expect(res.status).toBe(400);
      expect(await jsonOf(res)).toMatchObject({ error: 'invalid_image', message: 'too_large' });
    });

    it('cannot delete a picture still shown on the website, and removes its files once it is free', async () => {
      const media = await uploaded('غلاف');
      const service = await jsonOf(await api(admin).post('/services', { data: { slug: 'in-use', title_ar: 'مستعمل', cover_media_id: media.id } }));
      const refused = await api(admin).del(`/media/${media.id}`);
      expect(refused.status).toBe(409);
      expect(await jsonOf(refused)).toMatchObject({ error: 'media_in_use' });

      await api(admin).del(`/services/${service.id}?row_version=${service.row_version}`);
      expect((await fetch(`${s.baseUrl}${media.srcset[0].src}`)).status).toBe(200);   // reachable before, so the 404 below means something
      expect((await api(admin).del(`/media/${media.id}`)).status).toBe(204);
      expect((await fetch(`${s.baseUrl}${media.srcset[0].src}`)).status).toBe(404);
    });
  });

  describe('who may edit', () => {
    it('is the owner only: staff are refused, strangers are asked to sign in', async () => {
      for (const path of ['/media', '/services', '/gallery', '/settings']) {
        expect((await api(reception).get(path)).status).toBe(403);
        expect((await s.raw.get(`/api/v1/admin/content${path}`)).status).toBe(401);
      }
      expect((await upload(reception, await photoWithLocation(100, 100))).status).toBe(403);
    });

    it('another branch neither sees nor touches this branch\'s content', async () => {
      const service = await jsonOf(await api(admin).post('/services', { data: { slug: 'private-to-main', title_ar: 'خاص' } }));
      expect((await jsonOf<Json[]>(await api(otherAdmin).get('/services'))).map((x) => x.id)).not.toContain(service.id);
      const res = await api(otherAdmin).put(`/services/${service.id}`, { row_version: service.row_version, data: { slug: 'hijacked', title_ar: 'x' } });
      expect(res.status).toBe(404);
    });
  });

  describe('services', () => {
    it('stays off the website until published, and a picture must be described first', async () => {
      const cover = await uploaded();
      const draft = await jsonOf(await api(admin).post('/services', { data: {
        slug: 'Digital-Printing', title_ar: 'الطباعة الرقمية', summary_ar: 'طباعة سريعة بكميات صغيرة', cover_media_id: cover.id, is_featured: true,
      } }));
      expect(draft).toMatchObject({ slug: 'digital-printing', status: 'draft', row_version: 1 });           // the address is normalised
      expect(await jsonOf<Json[]>(await publicGet('/services'))).toEqual([]);

      const refused = await api(admin).post(`/services/${draft.id}/status`, { row_version: 1, status: 'published' });
      expect(refused.status).toBe(400);
      expect(await jsonOf(refused)).toMatchObject({ error: 'missing_alt_text' });

      await api(admin).patch(`/media/${cover.id}`, { alt_ar: 'آلة طباعة رقمية', alt_en: 'Digital press' });
      const published = await jsonOf(await api(admin).post(`/services/${draft.id}/status`, { row_version: 1, status: 'published' }));
      expect(published).toMatchObject({ status: 'published', row_version: 2 });

      const [ar] = await jsonOf<Json[]>(await publicGet('/services?lang=ar'));
      expect(ar).toMatchObject({ slug: 'digital-printing', title: 'الطباعة الرقمية', featured: true, image: { alt: 'آلة طباعة رقمية', width: 1200 } });
      expect(ar!.image.srcset.length).toBeGreaterThan(0);
      const [en] = await jsonOf<Json[]>(await publicGet('/services?lang=en'));
      expect(en).toMatchObject({ title: 'الطباعة الرقمية', image: { alt: 'Digital press' } });        // no English title yet: the Arabic is shown
      expect(await jsonOf(await publicGet('/services/digital-printing'))).toMatchObject({ summary: 'طباعة سريعة بكميات صغيرة' });
      expect(refreshes.length).toBeGreaterThan(0);
      expect(refreshes.at(-1)).toBe('Bearer test-revalidate-secret-0123456789');
    });

    it('refuses a save made over someone else\'s newer change', async () => {
      const service = await jsonOf(await api(admin).post('/services', { data: { slug: 'offset', title_ar: 'أوفست' } }));
      const first = await api(admin).put(`/services/${service.id}`, { row_version: 1, data: { slug: 'offset', title_ar: 'طباعة أوفست' } });
      expect(first.status).toBe(200);
      const stale = await api(admin).put(`/services/${service.id}`, { row_version: 1, data: { slug: 'offset', title_ar: 'قديم' } });
      expect(stale.status).toBe(409);
      expect(await jsonOf(stale)).toMatchObject({ error: 'version_conflict' });
    });

    it('keeps page addresses unique and well-formed', async () => {
      await api(admin).post('/services', { data: { slug: 'banners', title_ar: 'لافتات' } });
      const taken = await api(admin).post('/services', { data: { slug: 'banners', title_ar: 'أخرى' } });
      expect(taken.status).toBe(409);
      expect(await jsonOf(taken)).toMatchObject({ error: 'slug_taken' });
      expect((await api(admin).post('/services', { data: { slug: 'لافتات', title_ar: 'x' } })).status).toBe(400);
      expect((await api(admin).post('/services', { data: { slug: 'ok-slug', title_ar: '' } })).status).toBe(400);
    });

    it('hiding and deleting take it off the website; work filed under it stays in the showroom', async () => {
      const service = await jsonOf(await api(admin).post('/services', { data: { slug: 'packaging', title_ar: 'تغليف' } }));
      const live = await jsonOf(await api(admin).post(`/services/${service.id}/status`, { row_version: 1, status: 'published' }));
      const picture = await uploaded('علبة');
      const work = await jsonOf(await api(admin).post('/gallery', { data: { title_ar: 'علب حلويات', service_id: service.id, media_ids: [picture.id] } }));
      await api(admin).post(`/gallery/${work.id}/status`, { row_version: 1, status: 'published' });
      expect((await jsonOf<Json[]>(await publicGet('/gallery?service=packaging'))).map((x) => x.id)).toEqual([work.id]);

      const hidden = await jsonOf(await api(admin).post(`/services/${service.id}/status`, { row_version: live.row_version, status: 'draft' }));
      expect((await publicGet('/services/packaging')).status).toBe(404);
      expect((await api(admin).del(`/services/${service.id}?row_version=${hidden.row_version}`)).status).toBe(204);
      const [stillThere] = await jsonOf<Json[]>(await publicGet('/gallery')).then((items) => items.filter((x) => x.id === work.id));
      expect(stillThere).toMatchObject({ id: work.id, serviceSlug: null });
    });
  });

  describe('showroom', () => {
    it('shows several pictures per piece of work, in the owner\'s order', async () => {
      const [a, b] = [await uploaded('الوجه الأمامي'), await uploaded('الوجه الخلفي')];
      const work = await jsonOf(await api(admin).post('/gallery', { data: { title_ar: 'بطاقات أعمال', media_ids: [b.id, a.id], is_featured: true } }));
      expect(work.media_ids).toEqual([b.id, a.id]);
      await api(admin).post(`/gallery/${work.id}/status`, { row_version: 1, status: 'published' });
      const item = (await jsonOf<Json[]>(await publicGet('/gallery'))).find((x) => x.id === work.id)!;
      expect(item.images.map((i: Json) => i.alt)).toEqual(['الوجه الخلفي', 'الوجه الأمامي']);
      expect(item.featured).toBe(true);
    });

    it('will not publish work with no picture, or with a picture nobody described', async () => {
      const empty = await jsonOf(await api(admin).post('/gallery', { data: { title_ar: 'بلا صور', media_ids: [] } }));
      expect((await api(admin).post(`/gallery/${empty.id}/status`, { row_version: 1, status: 'published' })).status).toBe(400);
      const undescribed = await uploaded();
      const work = await jsonOf(await api(admin).post('/gallery', { data: { title_ar: 'غير موصوفة', media_ids: [undescribed.id] } }));
      expect(await jsonOf(await api(admin).post(`/gallery/${work.id}/status`, { row_version: 1, status: 'published' }))).toMatchObject({ error: 'missing_alt_text' });
    });

    it('refuses the same picture twice and a picture that does not exist', async () => {
      const pic = await uploaded('صورة');
      expect((await api(admin).post('/gallery', { data: { title_ar: 'مكرر', media_ids: [pic.id, pic.id] } })).status).toBe(400);
      expect((await api(admin).post('/gallery', { data: { title_ar: 'مفقود', media_ids: ['00000000-0000-4000-8000-000000000000'] } })).status).toBe(400);
    });
  });

  describe('the shop\'s details', () => {
    it('starts empty, saves with a version, and appears on the website', async () => {
      const settings = await jsonOf(await api(admin).get('/settings'));
      expect(settings).toMatchObject({ price_display: 'from', opening_hours: [], row_version: 1 });
      const saved = await api(admin).put('/settings', { row_version: settings.row_version, data: {
        tagline_ar: 'نطبع أفكارك', phone: '+96170123456', whatsapp: '+96170123456', address_ar: 'الهرمل، الشارع العام',
        map_url: 'https://maps.example.com/?q=shop', opening_hours: [{ days_ar: 'الاثنين - السبت', days_en: 'Mon - Sat', opens: '08:30', closes: '18:00' }],
        social_links: { instagram: 'https://instagram.com/shop' },
      } });
      expect(saved.status).toBe(200);
      const site = await jsonOf(await publicGet('/site?lang=en'));
      expect(site).toMatchObject({ name: 'MAIN', tagline: 'نطبع أفكارك', phone: '+96170123456', currency: 'USD', social: { instagram: 'https://instagram.com/shop' } });
      expect(site.hours).toEqual([{ days: 'Mon - Sat', opens: '08:30', closes: '18:00' }]);

      const stale = await api(admin).put('/settings', { row_version: settings.row_version, data: { tagline_ar: 'قديم' } });
      expect(stale.status).toBe(409);
    });

    it('refuses details that would break the website', async () => {
      const { row_version } = await jsonOf(await api(admin).get('/settings'));
      for (const data of [{ phone: '70123456' }, { map_url: 'http://insecure.example.com' }, { opening_hours: [{ days_ar: 'كل يوم', opens: '25:00', closes: '18:00' }] }, { social_links: { myspace: 'https://x.com' } }]) {
        expect((await api(admin).put('/settings', { row_version, data })).status, JSON.stringify(data)).toBe(400);
      }
    });

    it('shows product prices the way the owner chose: exact, "from", or not at all', async () => {
      await s.pool.query(
        `INSERT INTO products (branch_id, sku, slug, name_ar, name_en, base_price, pricing_model, price_rules, is_public, is_active)
         VALUES ($1, 'FLYER', 'flyers', 'منشورات', 'Flyers', 0.08, 'tiered', '[{"min_quantity":"500","unit_price":"0.04"}]', true, true),
                ($1, 'SECRET', NULL, 'داخلي', 'Internal', 5, 'per_unit', '[]', false, true)`, [s.fixtures.branchId]);
      const setDisplay = async (price_display: string) => {
        const { row_version } = await jsonOf(await api(admin).get('/settings'));
        expect((await api(admin).put('/settings', { row_version, data: { price_display } })).status).toBe(200);
      };
      const flyer = async () => (await jsonOf<Json[]>(await publicGet('/products?lang=en'))).find((p) => p.sku === 'FLYER');

      expect((await jsonOf<Json[]>(await publicGet('/products'))).map((p) => p.sku)).toEqual(['FLYER']);   // not-public products never appear
      await setDisplay('from');
      expect(await flyer()).toMatchObject({ name: 'Flyers', price: '0.04', priceIsFrom: true });           // the cheapest tier
      await setDisplay('exact');
      expect(await flyer()).toMatchObject({ price: '0.08', priceIsFrom: false });
      await setDisplay('hidden');
      expect(await flyer()).toMatchObject({ price: null });
    });
  });

  it('the shop\'s registered name reaches the website (for the legal pages), falling back to nothing when unset', async () => {
    expect((await jsonOf<Json>(await publicGet('/site?lang=ar'))).legalName).toBeNull();
    const current = await jsonOf<Json>(await admin.get('/api/v1/admin/team/branch-settings'));
    await fetch(`${s.baseUrl}/api/v1/admin/team/branch-settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
      body: JSON.stringify({ row_version: current.row_version, data: { legal_name_ar: 'مطبعة المصطفى', legal_name_en: 'Al-Mustafa Print' } }),
    });
    expect((await jsonOf<Json>(await publicGet('/site?lang=ar'))).legalName).toBe('مطبعة المصطفى');
    expect((await jsonOf<Json>(await publicGet('/site?lang=en'))).legalName).toBe('Al-Mustafa Print');
  });

  describe('products on the website', () => {
    let nextSku = 0;
    const product = (over: Record<string, unknown> = {}) =>
      ({ sku: `WEB-${++nextSku}`, name_ar: 'ملصقات', name_en: 'Stickers', base_price: '0.5', ...over }) as never;

    it('a product shown on the website carries its picture, and the site is told at once', async () => {
      const picture = await uploaded('ملصقات دائرية');
      const before = refreshes.length;
      const r = await pushOne(admin, mutation('products:insert', newId(), product({ is_public: true, cover_media_id: picture.id, description_ar: 'ملصقات بقص مخصص' })));
      expect(r).toMatchObject({ result: 'applied', row: { is_public: true, cover_media_id: picture.id } });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(refreshes.length).toBeGreaterThan(before);

      const shown = (await jsonOf<Json[]>(await publicGet('/products'))).find((p) => p.sku === r.row!.sku);
      expect(shown).toMatchObject({ description: 'ملصقات بقص مخصص', image: { alt: 'ملصقات دائرية' } });
    });

    it('refuses to show a product whose picture nobody described, whether it is added or edited', async () => {
      const undescribed = await uploaded();
      const added = await pushOne(admin, mutation('products:insert', newId(), product({ is_public: true, cover_media_id: undescribed.id })));
      expect(added).toMatchObject({ result: 'rejected', error: expect.stringContaining('missing_alt_text') });

      const id = newId();
      expect((await pushOne(admin, mutation('products:insert', id, product({ cover_media_id: undescribed.id })))).result).toBe('applied');   // hidden: fine
      const shown = await pushOne(admin, mutation('products:update', id, { changes: { is_public: true }, base: { is_public: false } }));
      expect(shown).toMatchObject({ result: 'rejected', error: expect.stringContaining('missing_alt_text') });
      expect(await s.pool.query('SELECT is_public FROM products WHERE id = $1', [id]).then((r) => r.rows)).toEqual([{ is_public: false }]);   // the refusal undid the write
    });

    it('a picture of another branch cannot be used', async () => {
      const foreign = await jsonOf(await upload(otherAdmin, await photoWithLocation(300, 300)));
      const r = await pushOne(admin, mutation('products:insert', newId(), product({ cover_media_id: foreign.id })));
      expect(r).toMatchObject({ result: 'rejected', error: expect.stringContaining('reference_not_found') });
    });

    it('a picture still used by a product cannot be deleted', async () => {
      const picture = await uploaded('صورة منتج');
      await pushOne(admin, mutation('products:insert', newId(), product({ cover_media_id: picture.id })));
      expect(await jsonOf(await api(admin).del(`/media/${picture.id}`))).toMatchObject({ error: 'media_in_use' });
    });

    describe('linked to a service page', () => {
      const publishedService = async (slug: string) => {
        const draft = await jsonOf<Json>(await api(admin).post('/services', { data: { slug, title_ar: slug } }));
        return jsonOf<Json>(await api(admin).post(`/services/${draft.id}/status`, { row_version: 1, status: 'published' }));
      };

      it('shows under the service it is linked to, and still shows unfiltered when that service is not published', async () => {
        const service = await publishedService('banners-service');
        await publishedService('flyers-service');
        const linked = await pushOne(admin, mutation('products:insert', newId(), product({ is_public: true, service_id: service.id })));
        expect(linked).toMatchObject({ result: 'applied' });
        const unlinked = await pushOne(admin, mutation('products:insert', newId(), product({ is_public: true })));

        const forService = await jsonOf<Json[]>(await publicGet('/products?service=banners-service'));
        expect(forService.map((p) => p.sku)).toEqual([linked.row!.sku]);
        expect(await jsonOf<Json[]>(await publicGet('/products?service=flyers-service'))).toEqual([]);   // the other service has none

        const all = await jsonOf<Json[]>(await publicGet('/products'));
        expect(all.map((p) => p.sku)).toEqual(expect.arrayContaining([linked.row!.sku, unlinked.row!.sku]));   // unfiltered: both show

        // hide the service: the product still shows in the general catalogue, but no longer under that service's filter
        await api(admin).post(`/services/${service.id}/status`, { row_version: 2, status: 'draft' });
        expect(await jsonOf<Json[]>(await publicGet('/products?service=banners-service'))).toEqual([]);
        expect((await jsonOf<Json[]>(await publicGet('/products'))).map((p) => p.sku)).toEqual(expect.arrayContaining([linked.row!.sku]));
      });

      it('can be changed after creation, and refuses a service from nowhere', async () => {
        const a = await publishedService('service-a');
        const b = await publishedService('service-b');
        const id = newId();
        expect((await pushOne(admin, mutation('products:insert', id, product({ is_public: true, service_id: a.id })))).result).toBe('applied');
        const moved = await pushOne(admin, mutation('products:update', id, { changes: { service_id: b.id }, base: { service_id: a.id } }));
        expect(moved).toMatchObject({ result: 'applied', row: { service_id: b.id } });
        expect((await jsonOf<Json[]>(await publicGet('/products?service=service-a'))).map((p) => p.id)).not.toContain(id);
        expect((await jsonOf<Json[]>(await publicGet('/products?service=service-b'))).map((p) => p.id)).toContain(id);

        const bogus = await pushOne(admin, mutation('products:insert', newId(), product({ service_id: newId() })));
        expect(bogus).toMatchObject({ result: 'rejected', error: expect.stringContaining('reference_not_found') });
      });
    });
  });
});


