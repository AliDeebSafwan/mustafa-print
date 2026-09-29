"""Fills a fresh, LOCAL shop with realistic demo content (services, pictures, showroom, products, contact details)
so the website can be designed and reviewed as it will really look. Demo data only: never point this at a real shop.
usage: seed_demo.py API_URL ADMIN_EMAIL ADMIN_PASSWORD IMAGE_DIR"""
import json, sys, uuid, urllib.request

API, EMAIL, PASSWORD, IMG = sys.argv[1:5]

def call(method, path, body=None, token=None, raw=None, ctype='application/json'):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(API + path, data=data, method=method, headers={**({'Content-Type': ctype} if data else {}), **({'Authorization': f'Bearer {token}'} if token else {})})
    with urllib.request.urlopen(req) as r:
        txt = r.read().decode()
        return json.loads(txt) if txt else None

tok = call('POST', '/api/v1/auth/login', {'identifier': EMAIL, 'password': PASSWORD})['accessToken']
C = '/api/v1/admin/content'

def upload(name, alt_ar, alt_en):
    boundary = uuid.uuid4().hex
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}.png"\r\nContent-Type: image/png\r\n\r\n').encode() + open(f'{IMG}/{name}.png', 'rb').read() + f'\r\n--{boundary}--\r\n'.encode()
    m = call('POST', f'{C}/media', token=tok, raw=body, ctype=f'multipart/form-data; boundary={boundary}')
    call('PATCH', f'{C}/media/{m["id"]}', {'alt_ar': alt_ar, 'alt_en': alt_en}, tok)
    return m['id']

media = {
    'hero': upload('hero', 'أوراق طباعة وبطاقات بألوان الطباعة الأربعة', 'Printed sheets and cards in the four process colours'),
    'cards': upload('cards', 'رزمة بطاقات عمل مطبوعة', 'A stack of printed business cards'),
    'flyers': upload('flyers', 'منشورات ملونة مروحة', 'A fan of colourful flyers'),
    'banner': upload('banner', 'رول أب إعلاني', 'A roll-up advertising banner'),
    'stickers': upload('stickers', 'ورقة ملصقات دائرية', 'A sheet of round stickers'),
    'menu': upload('menu', 'قائمة طعام مطبوعة مطوية', 'A folded printed restaurant menu'),
    'invitation': upload('invitation', 'بطاقة دعوة زفاف مع ظرف', 'A wedding invitation with its envelope'),
    'folders': upload('folders', 'ملف شركة مطبوع مع ورقة تعريفية', 'A printed company folder with a fact sheet'),
}

services = [
    ('business-cards', 'بطاقات العمل', 'Business cards', 'بطاقات أنيقة تُقدّمك بشكل يُذكر، بورق وتشطيبات تختارها.', 'Sharp cards that introduce you well, in the paper and finish you choose.', 'cards'),
    ('flyers-brochures', 'المنشورات والبروشورات', 'Flyers and brochures', 'منشورات وبروشورات بألوان ثابتة من أول نسخة إلى الألف.', 'Flyers and brochures with colour that stays the same from the first copy to the thousandth.', 'flyers'),
    ('banners-rollups', 'اللافتات والرول أب', 'Banners and roll-ups', 'لافتات ورول أب للمحلات والمعارض والمناسبات، مقاومة للشمس.', 'Banners and roll-ups for shops, fairs and events, built to face the sun.', 'banner'),
    ('stickers-labels', 'الملصقات والليبلات', 'Stickers and labels', 'ملصقات بأي شكل وحجم لمنتجاتك، قصّ دقيق وألوان ثابتة.', 'Stickers in any shape and size for your products, cleanly cut.', 'stickers'),
    ('menus', 'قوائم الطعام', 'Restaurant menus', 'قوائم مطوية أو مسطّحة تتحمّل الاستعمال اليومي.', 'Folded or flat menus that survive daily use.', 'menu'),
    ('invitations', 'بطاقات الدعوة', 'Invitations', 'دعوات أعراس ومناسبات بورق فاخر وتشطيب ذهبي.', 'Wedding and event invitations on fine paper with gold finishing.', 'invitation'),
]
sid = {}
for i, (slug, tar, ten, sar, sen, cover) in enumerate(services):
    body_ar = f'{sar}\n\nنطبع على أنواع ورق متعددة، ونراجع معك التصميم قبل الطباعة، ونسلّمك في الموعد الذي اتفقنا عليه.'
    body_en = f'{sen}\n\nWe print on a range of papers, check the design with you before printing, and deliver on the day we agreed.'
    s = call('POST', f'{C}/services', {'data': {'slug': slug, 'title_ar': tar, 'title_en': ten, 'summary_ar': sar, 'summary_en': sen, 'body_ar': body_ar, 'body_en': body_en, 'cover_media_id': media[cover], 'is_featured': i < 4, 'sort_order': i}}, tok)
    call('POST', f'{C}/services/{s["id"]}/status', {'status': 'published', 'row_version': s['row_version']}, tok)
    sid[slug] = s['id']

for i, (title_ar, title_en, svc, imgs) in enumerate([
    ('بطاقات مطعم الأرز', 'Rice Restaurant cards', 'business-cards', ['cards', 'hero']),
    ('قائمة طعام الهرمل', 'Hermel menu', 'menus', ['menu']),
    ('دعوة زفاف بختم ذهبي', 'Gold-foil wedding invitation', 'invitations', ['invitation']),
    ('رول أب افتتاح', 'Opening roll-up', 'banners-rollups', ['banner']),
    ('ملصقات منتج زعتر', 'Thyme product stickers', 'stickers-labels', ['stickers']),
    ('منشورات عرض الشتاء', 'Winter offer flyers', 'flyers-brochures', ['flyers']),
    ('ملف شركة تعريفي', 'Company profile folder', None, ['folders']),
    ('حملة الافتتاح الكاملة', 'The full opening campaign', 'banners-rollups', ['hero', 'banner', 'flyers']),
]):
    g = call('POST', f'{C}/gallery', {'data': {'title_ar': title_ar, 'title_en': title_en, 'description_ar': 'من أعمالنا.', 'description_en': 'One of our jobs.', 'service_id': sid.get(svc) if svc else None, 'media_ids': [media[m] for m in imgs], 'is_featured': i < 6, 'sort_order': i}}, tok)
    call('POST', f'{C}/gallery/{g["id"]}/status', {'status': 'published', 'row_version': g['row_version']}, tok)

cur = call('GET', f'{C}/settings', token=tok)
call('PUT', f'{C}/settings', {'row_version': cur['row_version'], 'data': {
    'tagline_ar': 'نطبع ما تريده، كما تريده، في موعده.', 'tagline_en': 'We print what you need, the way you need it, on time.',
    'about_ar': 'مطبعة عائلية في الهرمل نطبع فيها للمحلات والمدارس والمناسبات منذ سنوات. نراجع كل طلب معك قبل الطباعة.',
    'about_en': 'A family print shop in Hermel, printing for shops, schools and occasions for years. We check every order with you before it prints.',
    'phone': '+96170123456', 'whatsapp': '+96170123456', 'email': 'hello@example.com',
    'address_ar': 'الهرمل، الشارع العام', 'address_en': 'Hermel, main street',
    'opening_hours': [{'days_ar': 'الإثنين إلى السبت', 'days_en': 'Monday to Saturday', 'opens': '08:00', 'closes': '18:00'}],
    'social_links': {'instagram': 'https://instagram.com/example', 'facebook': 'https://facebook.com/example'},
    'hero_media_id': media['hero'],
}}, tok)

# products, through the same sync push the staff app uses
prods = [
    ('BC-500', 'بطاقات عمل 500 نسخة', 'Business cards, 500', 'business-cards', 'cards', 'set', 'fixed', '18', '1'),
    ('FLY-A5', 'منشورات A5', 'A5 flyers', 'flyers-brochures', 'flyers', 'sheet', 'per_unit', '0.08', '100'),
    ('RU-85', 'رول أب 85×200', 'Roll-up 85x200', 'banners-rollups', 'banner', 'piece', 'fixed', '45', '1'),
    ('STK-R', 'ملصقات دائرية', 'Round stickers', 'stickers-labels', 'stickers', 'sheet', 'per_unit', '0.5', '50'),
    ('MENU-A4', 'قائمة طعام A4 مطوية', 'Folded A4 menu', 'menus', 'menu', 'piece', 'per_unit', '0.9', '20'),
    ('INV-GOLD', 'دعوة زفاف بختم ذهبي', 'Gold-foil invitation', 'invitations', 'invitation', 'piece', 'per_unit', '1.2', '50'),
]
muts = [{'id': str(uuid.uuid4()), 'entity': 'products', 'entityId': str(uuid.uuid4()), 'op': 'insert', 'clientCreatedAt': '2026-01-01T00:00:00Z',
         'payload': {'sku': sku, 'name_ar': nar, 'name_en': nen, 'category': 'طباعة', 'unit': unit, 'pricing_model': model, 'base_price': price, 'min_quantity': minq,
                     'is_active': True, 'is_public': True, 'cover_media_id': media[img], 'service_id': sid[svc],
                     'description_ar': 'يُطبع بعد مراجعة التصميم معك.', 'description_en': 'Printed after we check the design with you.'}}
        for sku, nar, nen, svc, img, unit, model, price, minq in prods]
res = call('POST', '/api/v1/sync/push', {'deviceId': 'design-seed', 'mutations': muts}, tok)
bad = [r for r in res['results'] if r['result'] != 'applied']
print('seeded: 8 pictures, 6 services, 8 showroom items,', len(prods) - len(bad), 'products', ('- REJECTED: ' + json.dumps(bad)) if bad else '')
