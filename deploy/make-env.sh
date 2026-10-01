#!/usr/bin/env bash
# يكتب deploy/.env: يسألك عن العناوين والحساب، ويولّد الأسرار نفسه.
#
# الأسرار تُولَّد على هذا الخادم ولا تُطبع على الشاشة ولا تُكتب بيدك، وكلمة سر المدير تُكتب مخفيّة.
# الملف الناتج صلاحياته 600 (لا يقرأه غير صاحبه) وهو مستثنى من git.
#
#   ./make-env.sh              للتجربة المجانية (البريد في وضع console)
#   ./make-env.sh --resend     لنطاق حقيقي موثّق في Resend (يسألك عن المفتاح والمُرسِل)
set -euo pipefail
cd "$(dirname "$0")"

MODE_RESEND=0
[[ ${1:-} == "--resend" ]] && MODE_RESEND=1

if [[ -e .env ]]; then
  echo "deploy/.env موجود مسبقاً. انقله جانباً إن أردت ملفاً جديداً:  mv .env .env.old" >&2
  exit 1
fi
command -v openssl >/dev/null || { echo "openssl غير مثبّت:  sudo apt install -y openssl" >&2; exit 1; }

ask() {                                   # ask <نص السؤال> <اسم المتغير> [القيمة الافتراضية]
  local prompt=$1 var=$2 default=${3:-} answer=""
  while [[ -z $answer ]]; do
    read -rp "$prompt${default:+ [$default]}: " answer || exit 1
    answer=${answer:-$default}
    [[ -z $answer ]] && echo "  لا يمكن تركه فارغاً." >&2
  done
  printf -v "$var" '%s' "$answer"
}

ask_secret() {                            # ask_secret <نص السؤال> <اسم المتغير> <أقل طول>
  local prompt=$1 var=$2 min=$3 first="" again=""
  while :; do
    read -rsp "$prompt: " first; echo
    if (( ${#first} < min )); then echo "  يجب ألا تقل عن $min حرفاً." >&2; continue; fi
    read -rsp "  أعدها مرة أخرى: " again; echo
    [[ $first == "$again" ]] && break
    echo "  غير متطابقتين، أعد المحاولة." >&2
  done
  printf -v "$var" '%s' "$first"
}

echo "== العنوانان =="
echo "سجّلهما في duckdns.org (أو نطاقك) ووجّههما إلى عنوان IP هذا الخادم قبل التشغيل."
ask "عنوان الموقع للزبائن" SITE_DOMAIN
ask "عنوان تطبيق الطاقم" APP_DOMAIN "app-$SITE_DOMAIN"
[[ $SITE_DOMAIN == "$APP_DOMAIN" ]] && { echo "لا بد أن يكونا عنوانين مختلفين." >&2; exit 1; }
ask "بريدك لتنبيهات الشهادة" ACME_EMAIL

echo
echo "== حساب المدير الأول =="
ask "بريد المدير (به تسجّل الدخول)" SEED_ADMIN_EMAIL
ask_secret "كلمة سر المدير (12 حرفاً فأكثر، لا تظهر أثناء الكتابة)" SEED_ADMIN_PASSWORD 12
ask "اسم المدير كما يظهر" SEED_ADMIN_NAME "Owner"
ask "المنطقة الزمنية" SEED_BRANCH_TIMEZONE "Asia/Beirut"

EMAIL_PROVIDER=console; RESEND_API_KEY=""; EMAIL_FROM=""
if (( MODE_RESEND )); then
  echo
  echo "== البريد =="
  EMAIL_PROVIDER=resend
  ask_secret "مفتاح Resend (لا يظهر أثناء الكتابة)" RESEND_API_KEY 10
  ask "المُرسِل، على نطاق موثّق في Resend" EMAIL_FROM "Mustafa Print <no-reply@$SITE_DOMAIN>"
fi

umask 077                                  # الملف يُنشأ محجوباً عن غيرك منذ أول بايت
{
  echo "# وُلّد بـ make-env.sh في $(date -u '+%Y-%m-%d %H:%M UTC'). لا تضعه في git ولا ترسله إلى أحد."
  echo
  echo "SITE_DOMAIN=$SITE_DOMAIN"
  echo "APP_DOMAIN=$APP_DOMAIN"
  echo "ACME_EMAIL=$ACME_EMAIL"
  echo
  echo "POSTGRES_DB=mustafa"
  echo "POSTGRES_USER=mustafa"
  echo "POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d '\n')"
  echo
  echo "JWT_ACCESS_SECRET=$(openssl rand -base64 48 | tr -d '\n')"
  echo "REVALIDATE_SECRET=$(openssl rand -base64 48 | tr -d '\n')"
  echo
  echo "# بعد إنشاء حساب المدير احذف السطرين التاليين."
  echo "SEED_ADMIN_EMAIL=$SEED_ADMIN_EMAIL"
  echo "SEED_ADMIN_PASSWORD=$SEED_ADMIN_PASSWORD"
  echo "SEED_ADMIN_NAME=$SEED_ADMIN_NAME"
  echo "SEED_BRANCH_TIMEZONE=$SEED_BRANCH_TIMEZONE"
  echo
  echo "EMAIL_PROVIDER=$EMAIL_PROVIDER"
  echo "RESEND_API_KEY=$RESEND_API_KEY"
  echo "EMAIL_FROM=$EMAIL_FROM"
  echo
  echo "COMPOSE_PROFILES="
  echo "CLAMAV_HOST="
  echo "WHATSAPP_PROVIDER=console"
} > .env
chmod 600 .env

echo
echo "كُتب deploy/.env (صلاحيات 600). الأسرار وُلّدت هنا ولم تُطبع."
(( MODE_RESEND )) || echo "البريد في وضع console: رسائل الزبائن تُطبع في سجل الخادم ولا تُرسل."
cat <<'NEXT'

الخطوة التالية:
  ./deploy.sh
  docker compose run --rm migrate node dist/seed.js     # حساب المدير، مرة واحدة
  nano .env                                             # ثم احذف SEED_ADMIN_EMAIL و SEED_ADMIN_PASSWORD
NEXT
