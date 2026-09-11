BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SELECT 'casefold_handles' AS invariant, count(*) AS collision_groups FROM (SELECT lower(handle) FROM users GROUP BY lower(handle) HAVING count(*) > 1) x
UNION ALL SELECT 'casefold_emails', count(*) FROM (SELECT lower(email) FROM users WHERE email IS NOT NULL GROUP BY lower(email) HAVING count(*) > 1) x
UNION ALL SELECT 'registered_responses', count(*) FROM (SELECT "postId", "userId" FROM "Response" WHERE "userId" IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1) x
UNION ALL SELECT 'guest_responses', count(*) FROM (SELECT "postId", "guestId" FROM "Response" WHERE "guestId" IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1) x
UNION ALL SELECT 'guest_proofs', count(*) FROM (SELECT "postId", guest_proof_hash FROM "Response" WHERE guest_proof_hash IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1) x
UNION ALL SELECT 'duplicate_answers', count(*) FROM (SELECT "responseId", "questionId", "optionId" FROM "Answer" GROUP BY 1,2,3 HAVING count(*) > 1) x;
SELECT count(*) AS users_to_reserve FROM users;
SELECT count(*) AS responses_to_index FROM "Response";
SELECT count(*) AS answers_to_index FROM "Answer";
ROLLBACK;
