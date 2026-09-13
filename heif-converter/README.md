# Social Insight HEIF converter

خدمة داخلية صغيرة ومعزولة لتحويل صورة HEIC/HEIF مفردة إلى WebP. لا تستقبل multipart أو JSON، ولا تحفظ الملف بعد الطلب.

## عقد HTTP

`POST /v1/convert` يستقبل `application/octet-stream` مع `Content-Length` إلزامي بحد أقصى 15 MiB. الرؤوس المطلوبة:

- `X-SI-Timestamp`: Unix timestamp بالثواني، ضمن نافذة 300 ثانية افتراضيًا.
- `X-SI-Request-Id`: قيمة فريدة من 16–128 حرفًا (`A-Z a-z 0-9 _ -`).
- `X-SI-Body-SHA256`: بصمة SHA-256 للجسم بصيغة hex؛ تدخل في التوقيع وتُتحقق قبل تسليم الملف للمحوّل.
- `X-SI-Signature`: ‏`v1=<hex>` محسوبة كالآتي:

```text
bodyDigest = SHA256(rawBodyBytes).hex
canonical = "v1\n" + timestamp + "\n" + requestId + "\n" + bodyDigest
signature = "v1=" + HMAC_SHA256(HEIF_CONVERTER_HMAC_SECRET, canonical).hex
```

النجاح يعيد `image/webp` ورؤوس `X-Image-Width` و`X-Image-Height` و`X-SI-Request-Id`. معرّف الطلب أحادي الاستخدام داخل النسخة خلال نافذة التوقيع. في النشر متعدد النسخ يجب تنفيذ replay store مشترك عند الـgateway، أو توجيه request ID بثبات إلى نسخة واحدة.

## التحقق والمعالجة

- رفض body أكبر من 15 MiB، ورفض النقل chunked.
- فحص ISO-BMFF فعليًا؛ لا ثقة بالامتداد أو MIME القادم.
- قبول HEVC single-image فقط (`heic`/`heix` أو `mif1` العام عند وجود `hvcC`) ورفض AVIF وsequence/collection brands.
- إثبات `ispe` dimensions قبل decode ورفض المجموع الأكبر من 40 MP.
- مصادقة الرؤوس الموقعة قبل حجز سعة التحويل أو قراءة الجسم، ثم مطابقة البصمة الفعلية بعد القراءة ضمن مهلة كلية ثابتة.
- تشغيل decoder وSharp داخل عامل جديد لكل طلب، بلا سر HMAC وبلا شبكة، تحت `no_new_privs` وLandlock وseccomp وحدود CPU/ذاكرة افتراضية/ملفات/عمليات ومجموعة عمليات قابلة للإلغاء.
- مجلد خاص `0700` لكل عملية بملفين مُنشأين مسبقًا فقط، ثم إثبات توقف مجموعة العمليات وحذف المجلد إلزاميًا؛ أي فشل تنظيف يعطل الجاهزية.
- تحويل PNG الوسيط داخل العامل بواسطة Sharp 0.35.4 إلى WebP بجودة 92 و`alphaQuality=100`، وبحد أقصى 2400px للحافة. لا تُنسخ metadata، ويعاد فحص MIME والأبعاد بعد encode.
- رفض ناتج WebP الأكبر من 12 MiB حتى يطابق حد وسائط التطبيق.

## البناء والتشغيل المقيد

```bash
docker build --pull -t social-insight/heif-converter:1.0.0 ./heif-converter
docker run --rm \
  --read-only \
  --tmpfs /tmp/heif-converter:rw,noexec,nosuid,nodev,size=192m,mode=0700,uid=10001,gid=10001 \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --pids-limit 512 \
  --memory 512m \
  --memory-swap 512m \
  --cpus 1 \
  --network social-insight-internal \
  -e HEIF_CONVERTER_HMAC_SECRET='<secret-manager-reference>' \
  social-insight/heif-converter:1.0.0
```

لا تضع السر في image أو source أو logs؛ احقنه من secret manager. التطبيق يتطلب 32 byte على الأقل. الخدمة لا تحتاج إنترنت وقت التشغيل، لذا امنع egress، واسمح بالاتصال فقط من API الرئيسي عبر شبكة داخلية، وأضف mTLS أو network policy بينهما.

صورة Docker متعددة المراحل وتبني `libheif v1.23.4` مع `libde265 v1.1.1` فقط؛ AV1/JPEG/OpenH264/FFmpeg/x265 والـplugin loading والـencoders معطلة. `/health/ready` يفشل بدء التشغيل إذا لم يطابق runtime إصدار libheif/Sharp أو SHA-256 للـbinary والـmanifest المثبت، ويعرض الإصدارات وcommit الفعلي وdigest لتدقيق النسخة.

قبل فتح منفذ الخدمة، تثبت النسخة هوية المستخدم والقدرات الصفرية و`no_new_privs` وحدود cgroup والمشرف وLandlock/seccomp ومنع الشبكة، ثم تنفذ فحصًا أصليًا مرة واحدة على corpus صغير مثبت البصمة: صورة HEIC أحادية، نسخة HEIF عامة مشتقة حتميًا منها، وصورة HEIC تحتوي قناة شفافية. يمر الفحص عبر parser والعامل المعزول و`heif-convert` وSharp الفعلية، ويتحقق من WebP والأبعاد وإزالة metadata الموجودة في عينة المصدر ووجود قناة شفافية غير فارغة وتنظيف الملفات المؤقتة. لا يدّعي الفحص تطابق قناع alpha بكسلًا ببكسل. لا تتكرر عملية decode عند طلب `/health/ready`؛ يعرض المسار دليل الفحص غير الحساس والمجمد فقط، ويمنع الخادم الرئيسي قبول خدمة قديمة لا تحمل `native-still-v1` ودليل العزل المطابق.

العينتان مأخوذتان دون تعديل من corpus الرسمي لـlibheif (`tests/data/rainbow-451x461.heic` و`tests/data/with-alpha-512x512.heic`). تُخزنان Base64 كملفات root-owned للقراءة فقط، مع طول وSHA-256 ثابتين داخل الشيفرة. لا تُسجّل المدخلات أو المخرجات أو سر HMAC؛ يسجل بدء التشغيل معرفات الحالات والبصمات والأبعاد ونسخة Git الخاصة بـRender فقط.

## متغيرات التشغيل والحدود

| المتغير | الافتراضي | الحد المسموح |
|---|---:|---:|
| `PORT` | `8080` | 1–65535 |
| `MAX_BODY_BYTES` | 15 MiB | حتى 15 MiB |
| `MAX_AGGREGATE_PIXELS` | 40,000,000 | حتى 40 MP |
| `MAX_CONCURRENCY` | 1 | 1 فقط؛ لا تشغّل أكثر من تحويل داخل النسخة |
| `SIGNATURE_WINDOW_SECONDS` | 300 | 30–900 |

مهلة العامل الكلية ثابتة عند 45 ثانية، ومهلة decoder داخله 30 ثانية؛ لا يمكن رفعهما من البيئة حتى لا يتحول الإعداد إلى تجاوز لحد الأمان.

لا ترفع الحدود دون اختبار load/security مستقل. تعيد الخدمة `429 CONVERTER_BUSY` مباشرة عند امتلاء السعة، وعلى المستدعي retry محدودًا مع jitter، وألا يعيد المحاولة لأخطاء 4xx الأخرى.

## الاختبارات والنشر

```bash
cd heif-converter
npm test
docker build --pull -t social-insight/heif-converter:1.0.0 .
docker run --rm --entrypoint /usr/local/bin/heif-convert social-insight/heif-converter:1.0.0 --version
docker run --rm --entrypoint /usr/local/bin/si-heif-confine social-insight/heif-converter:1.0.0 --supervise-probe
```

اختبارات Node تستخدم converter مزيفًا ولا تحتاج Docker أو native codec، بينما فحص بدء الحاوية يستخدم decoder الحقيقي ويفشل قبل الاستماع إذا لم ينجح. الأمر `--supervise-probe` يشغّل حزمة Linux الموسعة على العينات المثبتة نفسها، بما في ذلك منع الشبكة وorphan reaping واستنفاد fork/thread والإلغاء وحدود ملف يقارب 15 MiB والتنظيف وOOM، ثم يخرج بنتيجة الفحص بدل تشغيل HTTP. شغّله على الصورة نفسها مع حدود الذاكرة/swap/pids المبينة أعلاه وسجّل المخرجات دون أسرار. قبل الإنتاج يجب إجراء build clean مع SBOM وفحص image، corpus سليم/خبيث أوسع، smoke عبر API الرئيسي، ثم بوابات E03/E04/E01 المستقلة. انشر canary أولًا وراقب `429` و`4xx` و`5xx` وtimeout وlatency p95/p99 وRSS واستخدام tmp. rollback هو إعادة API الرئيسي إلى رفض HEIF الآمن وتعطيل مسار الخدمة، ثم سحب نسخة الحاوية.
