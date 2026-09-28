#!/bin/bash
set -e
# Needs: PostgreSQL reachable at $PG_ADMIN_URL, `pnpm install` done, and `npm install` inside docs/training/tools.
HERE=$(cd "$(dirname "$0")" && pwd); R=$(cd "$HERE/../../.." && pwd); OUT=$R/docs/training/img
PG_ADMIN_URL=${PG_ADMIN_URL:-postgres://app:app@localhost:5432/postgres}
(cd $R/apps/api && pnpm build >/dev/null) && (cd $R/apps/admin && VITE_API_URL=http://127.0.0.1:4260 pnpm build >/dev/null)
psql "$PG_ADMIN_URL" -qc "DROP DATABASE IF EXISTS mpe_shots WITH (FORCE)" -c "CREATE DATABASE mpe_shots" 2>/dev/null
export DATABASE_URL=${PG_ADMIN_URL%/*}/mpe_shots
cd $R/apps/api && node dist/migrate.js >/dev/null && SEED_ADMIN_EMAIL=owner@almustafa.example SEED_ADMIN_PASSWORD=owner-password-long node dist/seed.js >/dev/null
setsid env JWT_ACCESS_SECRET=shots-secret-shots-secret-shots-secret-0 PORT=4260 NODE_ENV=production COOKIE_SECURE=false MEDIA_DIR=/tmp/shots-media \
  PUBLIC_WEB_URL=http://localhost:3360 EMAIL_PROVIDER=console CORS_ORIGINS=http://localhost:4173 SYNC_PULL_LAG_SECONDS=0 node dist/server.js > /tmp/shots-api.log 2>&1 < /dev/null &
API=$!
cd $R/apps/admin && setsid node_modules/.bin/vite preview --port 4173 --strictPort > /tmp/shots-ui.log 2>&1 < /dev/null &
UI=$!
trap 'kill $API $UI 2>/dev/null; ps aux | grep -E "[v]ite preview" | awk "{print \$2}" | xargs -r kill 2>/dev/null; sleep 1; psql "$PG_ADMIN_URL" -qc "DROP DATABASE IF EXISTS mpe_shots WITH (FORCE)" 2>/dev/null' EXIT
for i in $(seq 1 30); do curl -sf -o /dev/null http://127.0.0.1:4260/health && curl -sf -o /dev/null http://localhost:4173 && break; sleep 1; done
A=http://127.0.0.1:4260
uid() { python3 -c 'import uuid;print(uuid.uuid4())'; }
code() { python3 -c 'import secrets;a="0123456789ABCDEFGHJKMNPQRSTVWXYZ";print("".join(secrets.choice(a) for _ in range(12)))'; }
j() { python3 -c "import sys,json;print(json.load(sys.stdin)$1)"; }
n=0; mut() { n=$((n+1)); printf '{"id":"%s","entity":"%s","entityId":"%s","op":"%s","clientCreatedAt":"2026-09-27T08:%02d:%02dZ","payload":%s}' "$(uid)" "$1" "$2" "$3" $((n/60)) $((n%60)) "$4"; }
push() { curl -s -X POST $A/api/v1/sync/push -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d "{\"deviceId\":\"shots-device-01\",\"mutations\":[$1]}" | python3 -c "import sys,json;r=[x['result'] for x in json.load(sys.stdin)['results']];print(r if set(r)!={'applied'} else 'ok')"; }
T=$(curl -s -X POST $A/api/v1/auth/login -H 'Content-Type: application/json' -d '{"identifier":"owner@almustafa.example","password":"owner-password-long"}' | j "['accessToken']")
for u in '{"full_name":"حسن","email":"hasan@almustafa.example","password":"a good long password","role_key":"staff"}' \
         '{"full_name":"رامي","email":"rami@almustafa.example","phone_e164":"+96171444555","password":"a good long password","role_key":"delivery"}'; do
  curl -s -o /dev/null -X POST $A/api/v1/admin/team/users -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d "$u"; done
RAMI=$(psql "$DATABASE_URL" -qAt -c "SELECT id FROM users WHERE email = 'rami@almustafa.example'")
P1=$(uid); P2=$(uid); P3=$(uid); P4=$(uid)
echo "products: $(push "$(mut products $P1 insert '{"sku":"FLY-A5","name_ar":"منشورات A5","name_en":"A5 flyers","unit":"sheet","base_price":"0.08","is_public":true}'),$(mut products $P2 insert '{"sku":"BC-STD","name_ar":"بطاقات عمل (100 بطاقة)","name_en":"Business cards (100)","unit":"set","base_price":"12","is_public":true}'),$(mut products $P3 insert '{"sku":"ROLLUP","name_ar":"رول أب 85×200","name_en":"Roll-up 85x200","unit":"piece","base_price":"45","is_public":true}'),$(mut products $P4 insert '{"sku":"STK","name_ar":"ملصقات دائرية","name_en":"Round stickers","unit":"sheet","base_price":"0.5","is_public":true}')")"
C=(); for x in '"كريم سعد","+96170123456"' '"مدرسة الهرمل الرسمية","+96108200300"' '"ليلى ناصر","+96103555666"' '"مطعم الأرز","+96176888999"' '"سامي حداد","+96171222111"'; do
  id=$(uid); C+=($id); name=$(echo $x | cut -d, -f1); phone=$(echo $x | cut -d, -f2)
  push "$(mut customers $id insert "{\"full_name\":$name,\"phone_e164\":$phone,\"whatsapp_opt_in\":true,\"consent_source\":\"in_person\"}")" > /dev/null; done
O=(); item() { echo "{\"id\":\"$(uid)\",\"product_id\":\"$1\",\"name_snapshot\":\"$2\",\"quantity\":\"$3\",\"unit_price\":\"$4\"}"; }
order() { id=$(uid); O+=($id); push "$(mut orders $id insert "{\"public_code\":\"$(code)\",\"customer_id\":\"${C[$1]}\",$3\"items\":[$2]}")" > /dev/null; }
order 0 "$(item $P3 'رول أب 85×200' 2 45)" ''
order 1 "$(item $P1 'منشورات A5' 1000 0.08),$(item $P4 'ملصقات دائرية' 200 0.5)" ''
order 2 "$(item $P2 'بطاقات عمل (100 بطاقة)' 3 12)" ''
order 3 "$(item $P1 'منشورات A5 (قوائم طعام)' 500 0.08)" '"fulfillment_type":"delivery","delivery_address":"الهرمل - الشارع العام","delivery_city":"الهرمل","payment_method":"cod","delivery_fee":"3",'
order 4 "$(item $P4 'ملصقات دائرية' 100 0.5)" ''
st() { for s in "${@:2}"; do push "$(mut order_status_history $(uid) status_change "{\"order_id\":\"${O[$1]}\",\"to_status\":\"$s\",\"source\":\"manual\",\"occurred_at\":\"2026-09-27T09:00:00Z\"}")" > /dev/null; done; }
pay() { push "$(mut transactions $(uid) insert "{\"order_id\":\"${O[$1]}\",\"txn_type\":\"payment\",\"method\":\"cash\",\"amount\":\"$2\"}")" > /dev/null; }
paycod() { push "$(mut transactions $(uid) insert "{\"order_id\":\"${O[$1]}\",\"txn_type\":\"payment\",\"method\":\"cod\",\"amount\":\"$2\"}")" > /dev/null; }
pay 1 50; st 1 in_design printing
paycod 3 43; st 3 in_design printing finishing ready out_for_delivery   # a delivery run that collected cash, not yet handed to the shop
pay 2 36; st 2 in_design printing finishing ready
push "$(mut orders ${O[3]} update "{\"changes\":{\"delivery_user_id\":\"$RAMI\"},\"base\":{\"delivery_user_id\":null}}")" > /dev/null; st 3 in_design printing finishing ready out_for_delivery
pay 4 50; st 4 in_design printing finishing ready delivered
echo "orders: $(psql "$DATABASE_URL" -qAt -c "SELECT string_agg(status || ':' || paid_total, ' ' ORDER BY placed_at) FROM orders")"
PLAN=$(python3 - "${O[0]}" "${C[0]}" <<'PY'
import json, sys
o0, c0 = sys.argv[1], sys.argv[2]
print(json.dumps([
 {"user": "hasan@almustafa.example", "password": "a good long password", "waitFor": "كريم سعد", "loginShot": "staff-01-login", "readyShot": "staff-00-offline-ready", "shots": [
   {"name": "staff-02-orders", "path": "/", "waitFor": "كريم سعد"},
   {"name": "staff-03-new-order", "path": "/orders/new", "steps": [{"type": "input[aria-label]", "text": "ليلى"}, {"clickText": "ليلى ناصر"}, {"selectFirst": "select[aria-label]"}], "then": [{"scrollText": "الاستلام", "name": "staff-03b-new-order-bottom"}]},
   {"name": "staff-04-order", "path": f"/orders/{o0}", "waitFor": "كريم سعد", "then": [{"scrollText": "المدفوعات", "name": "staff-04b-order-payment"}, {"scrollText": "رسالة يدوية", "name": "staff-04c-order-more"}]},
   {"name": "staff-05-label", "path": f"/orders/{o0}/label", "waitFor": "كريم سعد"},
   {"name": "staff-06-scan", "path": "/scan"},
   {"name": "staff-07-customer", "path": f"/customers/{c0}/edit", "full": True},
   {"name": "staff-08-quotes", "path": "/quotes"},
   {"name": "staff-09-settings", "path": "/settings", "full": True}]},
  {"user": "owner@almustafa.example", "password": "owner-password-long", "waitFor": "كريم سعد", "shots": [
   {"name": "owner-01-reports", "path": "/reports", "full": True},
   {"name": "owner-02-unpaid", "path": "/reports/unpaid", "full": True},
   {"name": "owner-03-settings", "path": "/settings", "full": True},
   {"name": "owner-04-team", "path": "/team", "full": True},
   {"name": "owner-05-shop-settings", "path": "/team/settings", "full": True},
   {"name": "owner-06-products", "path": "/products", "full": True},
   {"name": "owner-06b-import", "path": "/products/import", "full": True},
   {"name": "owner-10-checklist", "path": "/checklist", "full": True},
   {"name": "owner-07-reconcile", "path": "/reconcile", "full": True},
   {"name": "owner-08-site", "path": "/site", "full": True},
   {"name": "owner-09-messages", "path": "/messages", "full": True}]},
]))
PY
)
rm -f $OUT/*.png
node "$HERE/shots.mjs" http://localhost:4173 $OUT "$PLAN" 2>&1
