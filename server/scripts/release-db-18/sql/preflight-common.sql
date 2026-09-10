IF EXISTS (SELECT lower(email) FROM public.users WHERE email IS NOT NULL GROUP BY 1 HAVING count(*)>1)
 OR EXISTS (SELECT lower(handle) FROM public.users GROUP BY 1 HAVING count(*)>1)
THEN RAISE EXCEPTION 'IDENTITY_COLLISION'; END IF;
IF EXISTS (SELECT 1 FROM public."Response" WHERE "userId" IS NOT NULL GROUP BY "postId","userId" HAVING count(*)>1)
 OR EXISTS (SELECT 1 FROM public."Response" WHERE "guestId" IS NOT NULL GROUP BY "postId","guestId" HAVING count(*)>1)
 OR EXISTS (SELECT 1 FROM public."Answer" GROUP BY "responseId","questionId","optionId" HAVING count(*)>1)
THEN RAISE EXCEPTION 'VOTE_COLLISION'; END IF;
IF EXISTS (SELECT 1 FROM public."Post" p WHERE p."responseCount"<>(SELECT count(*) FROM public."Response" r WHERE r."postId"=p.id))
 OR EXISTS (SELECT 1 FROM public."Option" o WHERE o.votes<>(SELECT count(*) FROM public."Answer" a WHERE a."optionId"=o.id))
 OR EXISTS (SELECT 1 FROM public."Answer" a JOIN public."Option" o ON o.id=a."optionId" WHERE a."questionId"<>o."questionId")
 OR EXISTS (SELECT 1 FROM public."Answer" a JOIN public."Question" q ON q.id=a."questionId" JOIN public."Response" r ON r.id=a."responseId" WHERE q."postId" IS NOT NULL AND q."postId"<>r."postId")
 OR EXISTS (SELECT 1 FROM public."Answer" a JOIN public."Question" q ON q.id=a."questionId" JOIN public."Section" s ON s.id=q."sectionId" JOIN public."Response" r ON r.id=a."responseId" WHERE s."postId"<>r."postId")
THEN RAISE EXCEPTION 'VOTE_RELATION_OR_COUNTER_MISMATCH'; END IF;
IF EXISTS (SELECT 1 FROM public."MediaAsset" WHERE "uploadKey" IS NOT NULL AND "uploadBucket" IS NULL)
THEN RAISE EXCEPTION 'MEDIA_REVIEW_REQUIRED'; END IF;
IF to_regclass('public.handle_aliases') IS NOT NULL OR to_regclass('public.security_email_outbox') IS NOT NULL OR to_regclass('public.deletion_decisions') IS NOT NULL THEN RAISE EXCEPTION 'PARTIAL_FUTURE_SCHEMA'; END IF;
