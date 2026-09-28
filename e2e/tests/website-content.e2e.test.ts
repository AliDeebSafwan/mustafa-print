import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hasTestDatabase } from '../../apps/api/tests/helpers/test-db'
import { startTestServer, type ApiClient, type TestServer } from '../../apps/api/tests/helpers/test-server'
import { ContentError, createContentApi } from '../../apps/admin/src/content/api'

/**
 * The owner's real website editor (the staff app's content client) against the real API and database:
 * from uploading a photo to the page a customer sees.
 */
describe.skipIf(!hasTestDatabase)('the owner builds the website', () => {
  let s: TestServer
  let owner: ApiClient, worker: ApiClient
  const editorFor = (client: ApiClient) => createContentApi({ baseUrl: s.baseUrl, getToken: async () => client.token ?? null })
  const publicRead = async <T,>(path: string): Promise<T> => (await fetch(`${s.baseUrl}/api/v1/public/site${path}`)).json() as Promise<T>

  beforeAll(async () => {
    s = await startTestServer()
    owner = await s.as('admin')
    worker = await s.as('receptionist')
  })
  afterAll(async () => { await s.close() })

  it('from a phone photo to a published service and showroom piece, in both languages', async () => {
    const editor = editorFor(owner)
    const photo = await sharp({ create: { width: 1800, height: 1200, channels: 3, background: '#39c' } })
      .withExif({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '34/1 21/1 0/1' } }).jpeg().toBuffer()

    const picture = await editor.media.upload(new Blob([new Uint8Array(photo)], { type: 'image/jpeg' }), 'press.jpg')
    expect(picture.srcset.map((v) => v.width)).toEqual([480, 800, 1200, 1600])

    const service = await editor.services.create({ slug: 'digital-printing', title_ar: 'الطباعة الرقمية', title_en: 'Digital printing', cover_media_id: picture.id, is_featured: true })
    // publishing is refused until the picture is described, with a code the screen can explain
    await expect(editor.services.setStatus(service, 'published')).rejects.toMatchObject({ code: 'missing_alt_text' })
    await editor.media.describe(picture.id, { alt_ar: 'آلة طباعة رقمية', alt_en: 'A digital press' })
    await editor.services.setStatus(service, 'published')

    const work = await editor.gallery.create({ title_ar: 'بطاقات أعمال', service_id: service.id, media_ids: [picture.id], is_featured: true })
    await editor.gallery.setStatus(work, 'published')

    const ar = await publicRead<{ title: string; image: { alt: string } }[]>('/services?lang=ar')
    const en = await publicRead<{ title: string; image: { alt: string } }[]>('/services?lang=en')
    expect(ar).toMatchObject([{ title: 'الطباعة الرقمية', image: { alt: 'آلة طباعة رقمية' } }])
    expect(en).toMatchObject([{ title: 'Digital printing', image: { alt: 'A digital press' } }])
    expect(await publicRead<unknown[]>('/gallery?service=digital-printing')).toHaveLength(1)

    // the picture a visitor's browser downloads carries no location
    const src = (await publicRead<{ image: { srcset: { src: string }[] } }[]>('/services'))[0]!.image.srcset[0]!.src
    const served = Buffer.from(await (await fetch(`${s.baseUrl}${src}`)).arrayBuffer())
    expect((await sharp(served).metadata()).exif).toBeUndefined()
  })

  it('the shop details, including how prices are shown, reach the website', async () => {
    const editor = editorFor(owner)
    const settings = await editor.settings.get()
    await editor.settings.save(settings, { tagline_ar: 'نطبع أفكارك', phone: '+96170123456', price_display: 'hidden' })
    expect(await publicRead('/site?lang=ar')).toMatchObject({ tagline: 'نطبع أفكارك', phone: '+96170123456' })
    await expect(editor.settings.save(settings, { tagline_ar: 'قديم' })).rejects.toMatchObject({ code: 'version_conflict' })
  })

  it('the worker cannot touch the website, and is told why', async () => {
    const editor = editorFor(worker)
    await expect(editor.services.list()).rejects.toBeInstanceOf(ContentError)
    await expect(editor.services.list()).rejects.toMatchObject({ code: 'forbidden' })
    await expect(editor.media.upload(new Blob(['x']), 'x.jpg')).rejects.toMatchObject({ code: 'forbidden' })
  })
})
