# Social Insight HEIF converter

خدمة داخلية صغيرة ومعزولة لتحويل صورة HEIC/HEIF مفردة إلى WebP. لا تستقبل multipart أو JSON، ولا تحفظ الملف بعد الطلب.

## عقد HTTP

`POST /v1/convert` يستقبل `application/octet-stream` مع `Content-Length` إلزامي بحد أقصى 15 MiB. الرؤوس المطلوبة:

- `X-SI-Timestamp`: Unix timestamp بالثواني، ضمن نافذة 300 ثانية افتراضيًا.
- `X-SI-Request-Id`: قيمة فريدة من 16–128 حرفًا (`A-Z a-z 0-9 _ -`).
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
- تشغيل `heif-convert` عبر `prlimit` دون shell، ببيئة مصغرة لا ترث الأسرار، وحدود CPU/RSS/file/process، وtimeout 15 ثانية، وحد 8 KiB للمخرجات التشخيصية.
- مجلد خاص `0700` لكل عملية، ثم حذف مضمون في `finally`.
- تحويل PNG الوسيط بواسطة Sharp 0.35.4 إلى WebP بجودة 92 و`alphaQuality=100`، وبحد أقصى 2400px للحافة. لا تُنسخ metadata، ويعاد فحص MIME والأبعاد بعد encode.
- رفض ناتج WebP الأكبر من 12 MiB حتى يطابق حد وسائط التطبيق.

## البناء والتشغيل المقيد

```bash
docker build --pull -t social-insight/heif-converter:1.0.0 ./heif-converter
docker run --rm \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=256m,mode=1777 \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --pids-limit 64 \
  --memory 1g \
  --cpus 2 \
  --network social-insight-internal \
  -e HEIF_CONVERTER_HMAC_SECRET='<secret-manager-reference>' \
  social-insight/heif-converter:1.0.0
```

لا تضع السر في image أو source أو logs؛ احقنه من secret manager. التطبيق يتطلب 32 byte على الأقل. الخدمة لا تحتاج إنترنت وقت التشغيل، لذا امنع egress، واسمح بالاتصال فقط من API الرئيسي عبر شبكة داخلية، وأضف mTLS أو network policy بينهما.

صورة Docker متعددة المراحل وتبني `libheif v1.23.3` مع `libde265 v1.1.1` فقط؛ AV1/JPEG/OpenH264/FFmpeg/x265 والـplugin loading والـencoders معطلة. `/health/ready` يفشل بدء التشغيل إذا لم يطابق runtime إصدار libheif/Sharp أو SHA-256 للـbinary والـmanifest المثبت، ويعرض الإصدارات وcommit الفعلي وdigest لتدقيق النسخة.

## متغيرات التشغيل والحدود

| المتغير | الافتراضي | الحد المسموح |
|---|---:|---:|
| `PORT` | `8080` | 1–65535 |
| `MAX_BODY_BYTES` | 15 MiB | حتى 15 MiB |
| `MAX_AGGREGATE_PIXELS` | 40,000,000 | حتى 40 MP |
| `MAX_CONCURRENCY` | 1 | 1 فقط؛ لا تشغّل أكثر من تحويل داخل النسخة |
| `CONVERSION_TIMEOUT_MS` | 15,000 | 1,000–30,000 |
| `SIGNATURE_WINDOW_SECONDS` | 300 | 30–900 |

لا ترفع الحدود دون اختبار load/security مستقل. تعيد الخدمة `429 CONVERTER_BUSY` مباشرة عند امتلاء السعة، وعلى المستدعي retry محدودًا مع jitter، وألا يعيد المحاولة لأخطاء 4xx الأخرى.

## الاختبارات والنشر

```bash
cd heif-converter
npm test
docker build --pull -t social-insight/heif-converter:1.0.0 .
docker run --rm --entrypoint /usr/local/bin/heif-convert social-insight/heif-converter:1.0.0 --version
```

اختبارات Node تستخدم converter مزيفًا ولا تحتاج Docker أو native codec. قبل الإنتاج يجب إجراء build clean مع SBOM وفحص image، corpus سليم/خبيث حقيقي، اختبار موارد وتزامن، smoke عبر API الرئيسي، ثم بوابات E03/E04/E01 المستقلة. انشر canary أولًا وراقب `429` و`4xx` و`5xx` وtimeout وlatency p95/p99 وRSS واستخدام tmp. rollback هو إعادة API الرئيسي إلى رفض HEIF الآمن وتعطيل مسار الخدمة، ثم سحب نسخة الحاوية.
