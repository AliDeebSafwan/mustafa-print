# تشغيل النظام على الخادم

هذا الدليل يضع الموقع وتطبيق الموظفين على خادم واحد (VPS) بعنوانين:

- **عنوان الموقع** للزبائن، مثل `almustafa-print.com`.
- **عنوان التطبيق** للطاقم، مثل `app.almustafa-print.com`.

شهادات HTTPS يحصل عليها Caddy ويجدّدها وحده.

## ما تحتاجه قبل البدء

- **الخادم:** Ubuntu 24.04، ذاكرة 2 غيغابايت على الأقل (4 أفضل)، قرص 40 غيغابايت.
- **النطاق:** سجلّان من نوع `A` يشيران إلى عنوان الخادم، واحد للموقع وآخر للتطبيق. أضف `www` أيضاً إن أردت.
- **على الخادم:** Docker مع إضافة compose، و`postgresql-client-16` و`gnupg` لأجل النسخ الاحتياطي.
- **البريد الإلكتروني (إلزامي قبل فتح حسابات الزبائن):** حساب في [Resend](https://resend.com) (الباقة المجانية تكفي مطبعة) ونطاقك موثّق فيه.
  بدونه لا تصل روابط تأكيد البريد واستعادة كلمة السر، وتُكتب في سجلات الخادم حيث قد يقرؤها غيرك.

## أول تشغيل

```bash
# 1) الكود
sudo mkdir -p /srv/mustafa-print && cd /srv/mustafa-print     # ضع الكود هنا (git clone أو فك الملف المضغوط)
cd deploy

# 2) الإعدادات
cp .env.example .env
nano .env        # املأ العنوانين والبريد وكلمات السر (كل سرّ: openssl rand -base64 48) وحساب المدير الأول

# 3) كلمة سر النسخ الاحتياطي: احفظ نسخة منها خارج الخادم، فبدونها لا تُستعاد أي نسخة
openssl rand -base64 48 | sudo tee /root/.mpe-backup-passphrase >/dev/null && sudo chmod 600 /root/.mpe-backup-passphrase

# 4) التشغيل
./deploy.sh

# 5) حساب المدير الأول (مرة واحدة فقط)
docker compose run --rm migrate node dist/seed.js
```

بعدها احذف سطري `SEED_ADMIN_EMAIL` و`SEED_ADMIN_PASSWORD` من `.env`.

افتح عنوان التطبيق وسجّل الدخول، ثم أضف الخدمات والصور من تبويب «الموقع».

## النسخ الاحتياطي، وهو أهم ما في هذا الدليل

```bash
crontab -e      # الصق محتوى crontab.example بعد تعديل المسار
```

- **كل ليلة:** نسخة مشفّرة من قاعدة البيانات **والصور معاً**، وتُحذف النسخ الأقدم من 14 يوماً.
- **كل أحد:** `restore-check.sh` يستعيد أحدث نسخة في قاعدة مؤقتة ويقارنها بالنظام الحي. إن فشل يصلك بريد. **النسخة التي لم تُجرَّب استعادتها ليست نسخة.**
- **خارج الخادم:** انسخ النسخ الاحتياطية إلى مكان آخر (rclone إلى Backblaze B2 أو Google Drive). احتراق الخادم يأخذ نسخه معه.

**الاستعادة بعد كارثة** (خادم جديد):

```bash
./deploy.sh                                   # نظام فارغ
docker compose stop api worker web
docker compose exec db dropdb -U "$POSTGRES_USER" "$POSTGRES_DB" && docker compose exec db createdb -U "$POSTGRES_USER" "$POSTGRES_DB"
rm -rf data/media/*
BACKUP_PASSPHRASE_FILE=/root/.mpe-backup-passphrase ./restore.sh backups/mpe-XXXX.tar.gpg \
  "postgres://$POSTGRES_USER:$POSTGRES_PASSWORD@127.0.0.1:5432/$POSTGRES_DB" data/media
docker compose up -d
```

`restore.sh` يرفض الكتابة فوق قاعدة أو مجلد فيه بيانات، ويرفض نسخة تالفة أو كلمة سر خاطئة.

## التحديث

```bash
cd /srv/mustafa-print && git pull      # أو انسخ الإصدار الجديد
cd deploy && ./deploy.sh
```

- يأخذ `deploy.sh` نسخة احتياطية **قبل** التحديث.
- تُطبَّق تغييرات قاعدة البيانات تلقائياً، ولا يبدأ الخادم إن فشلت.
- يُملأ الموقع فوراً بعد التشغيل.

## حين يحدث شيء

| العَرَض | ما تفعله |
| --- | --- |
| الموقع لا يفتح | `docker compose ps` ثم `docker compose logs --tail 100 web api caddy` |
| «شهادة غير صالحة» | تأكد أن سجلّي DNS يشيران للخادم، وأن المنفذين 80 و443 مفتوحان، ثم `docker compose logs caddy` |
| التطبيق لا يتزامن | `docker compose logs --tail 100 api`؛ الموظفون يستطيعون العمل دون اتصال في هذه الأثناء |
| امتلأ القرص | `du -sh data/* backups`؛ الصور والنسخ هي الأكبر عادةً |

## ما لم يُختبر بعد على خادم حقيقي

- **ما جُرِّب محلياً دون Docker:**
  - ترتيب الإنتاج كاملاً: الخادم المبني، والموقع مرتّباً كما في ملف Docker الخاص به، وتطبيق الموظفين، وCaddy بإعداد مشتق من `Caddyfile` الحقيقي.
  - النسخ الاحتياطي والاستعادة على PostgreSQL حقيقي.
- **ما لم يُشغَّل أبداً:** بناء صور Docker نفسها، وملف `compose.yaml`، وحصول Caddy على الشهادات، لأن Docker والنطاق الحقيقي غير متاحين في بيئة التطوير.

أول تشغيل على الخادم هو اختبارها الحقيقي.
