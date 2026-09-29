"""Adds one customer with an order, a quote and a proof to the demo shop, so the pages a customer reaches from a link
(order tracking, quote, proof) can be reviewed with real content. Demo data only.
usage: seed_flows.py API_URL ADMIN_EMAIL ADMIN_PASSWORD IMAGE_DIR  -> prints JSON with the three public codes"""
import json, sys, uuid, urllib.request
API, EMAIL, PASSWORD, IMG = sys.argv[1:5]

def call(method, path, body=None, token=None, raw=None, ctype='application/json'):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(API + path, data=data, method=method, headers={**({'Content-Type': ctype} if data else {}), **({'Authorization': f'Bearer {token}'} if token else {})})
    with urllib.request.urlopen(req) as r:
        txt = r.read().decode(); return json.loads(txt) if txt else None

tok = call('POST', '/api/v1/auth/login', {'identifier': EMAIL, 'password': PASSWORD})['accessToken']
push = lambda muts: call('POST', '/api/v1/sync/push', {'deviceId': 'design-flows', 'mutations': muts}, tok)['results']
import secrets
code = lambda: ''.join(secrets.choice('0123456789ABCDEFGHJKMNPQRSTVWXYZ') for _ in range(12))   # the device makes the public code
mut = lambda entity, eid, op, payload: {'id': str(uuid.uuid4()), 'entity': entity, 'entityId': eid, 'op': op, 'clientCreatedAt': '2026-01-01T00:00:00Z', 'payload': payload}

cust = str(uuid.uuid4())
r = push([mut('customers', cust, 'insert', {'full_name': 'مطعم الأرز', 'phone_e164': '+96170999888'})])
if r[0]['result'] == 'conflict' and r[0].get('error') == 'phone_already_registered': cust = r[0]['row']['id']   # seeded before: reuse it
else: assert r[0]['result'] == 'applied', r
order = str(uuid.uuid4())
order_code = code()
r = push([mut('orders', order, 'insert', {'public_code': order_code, 'customer_id': cust, 'items': [
    {'id': str(uuid.uuid4()), 'name_snapshot': 'قائمة طعام A4 مطوية', 'quantity': '200', 'unit_price': '0.9'},
    {'id': str(uuid.uuid4()), 'name_snapshot': 'بطاقات عمل 500 نسخة', 'quantity': '1', 'unit_price': '18'}]})])
assert r[0]['result'] == 'applied', r
for st in ('in_design', 'printing'):
    rr = push([mut('order_status_history', str(uuid.uuid4()), 'status_change', {'order_id': order, 'to_status': st, 'source': 'manual', 'occurred_at': '2026-09-27T09:00:00Z'})])
    assert rr[0]['result'] == 'applied', rr

q = call('POST', '/api/v1/admin/quotes', {'customer_id': cust, 'valid_days': 14, 'notes': 'السعر يشمل التصميم ومراجعة واحدة.', 'items': [
    {'name': 'رول أب 85×200 مع الحقيبة', 'quantity': '2', 'unit_price': '45'},
    {'name': 'ملصقات دائرية 5 سم', 'quantity': '500', 'unit_price': '0.12', 'discount': '5'}]}, tok)

order2 = str(uuid.uuid4())
r = push([mut('orders', order2, 'insert', {'public_code': code(), 'customer_id': cust, 'items': [{'id': str(uuid.uuid4()), 'name_snapshot': 'دعوة زفاف بختم ذهبي', 'quantity': '150', 'unit_price': '1.2'}]})])
assert r[0]['result'] == 'applied', r
boundary = uuid.uuid4().hex
body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="proof.png"\r\nContent-Type: image/png\r\n\r\n').encode() + open(f'{IMG}/invitation.png', 'rb').read() + f'\r\n--{boundary}--\r\n'.encode()
proof = call('POST', f'/api/v1/admin/orders/{order2}/proofs', token=tok, raw=body, ctype=f'multipart/form-data; boundary={boundary}')
print(json.dumps({'order': order_code, 'quote': q.get('public_code') or q.get('code'), 'proof': proof.get('public_code') or proof.get('code')}))
