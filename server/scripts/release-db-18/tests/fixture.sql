-- Synthetic values only; valid on both the legacy-10 and Stage-15 schemas.
INSERT INTO public.users(id,name,handle,email,status,is_private,updated_at)
VALUES ('fixture_u1','Synthetic owner','FixtureOwner','OWNER@fixture.invalid','ACTIVE',true,now()),
 ('fixture_u2','Synthetic voter','FixtureVoter','voter@fixture.invalid','ACTIVE',false,now()),
 ('fixture_u3','Synthetic deleted','FixtureDeleted',NULL,'DELETED',false,now());
INSERT INTO public.user_demographics(user_id,gender,updated_at) VALUES('fixture_u1','undisclosed',now());
INSERT INTO public."Group"(id,name,description,category,"isPublic","updatedAt") VALUES('fixture_g1','Synthetic private group','Synthetic','Synthetic',false,now());
INSERT INTO public."GroupMember"(id,"userId","groupId",role,status) VALUES('fixture_gm1','fixture_u1','fixture_g1','Owner','JOINED');
INSERT INTO public."Post"(id,title,description,type,"authorId","groupId","expiresAt","updatedAt","responseCount")
 VALUES('fixture_p1','Synthetic poll','Synthetic','SURVEY','fixture_u1','fixture_g1',now()+interval '1 day',now(),2);
INSERT INTO public."Question"(id,text,type,"postId") VALUES('fixture_q1','Synthetic choice','single','fixture_p1'),('fixture_q2','Synthetic text','text','fixture_p1');
INSERT INTO public."Option"(id,text,"questionId",votes) VALUES('fixture_o1','Synthetic option','fixture_q1',2);
INSERT INTO public."Response"(id,"userId","guestId","postId") VALUES('fixture_r1','fixture_u2',NULL,'fixture_p1'),('fixture_r2',NULL,'synthetic_legacy_guest','fixture_p1');
INSERT INTO public."Answer"(id,"responseId","questionId","optionId","textValue") VALUES('fixture_a1','fixture_r1','fixture_q1','fixture_o1',NULL),('fixture_a2','fixture_r2','fixture_q1','fixture_o1',NULL),('fixture_a3','fixture_r1','fixture_q2',NULL,'Synthetic text');
INSERT INTO public."MediaAsset"(id,"ownerId",purpose,status,"accessScope","sourceMime","uploadBucket","uploadKey","expiresAt","updatedAt")
 VALUES('fixture_m1','fixture_u1','POST','READY','RESTRICTED','image/webp','synthetic-private','synthetic/upload/one',now()+interval '30 minutes',now()),
 ('fixture_m2','fixture_u1','POST','PENDING_DELETE','RESTRICTED','image/webp','synthetic-private','synthetic/upload/two',now()+interval '30 minutes',now());
INSERT INTO public."PostMedia"(id,"postId","mediaAssetId","sortOrder") VALUES('fixture_pm1','fixture_p1','fixture_m1',0);
INSERT INTO public."MediaPrivacyTransition"(id,"userId","targetIsPrivate",status,"updatedAt") VALUES('fixture_transition','fixture_u1',true,'PENDING',now());
INSERT INTO public."PendingRegistration"(id,email,"fullName",dob,password,handle,"otpCode","otpExpiresAt","updatedAt") VALUES('fixture_pending','pending@fixture.invalid','Synthetic pending',DATE '1990-01-01','synthetic-legacy','synthetic_pending','000000',now()-interval '1 hour',now());
INSERT INTO public."OTPCode"(id,identifier,code,"expiresAt") VALUES('fixture_otp','pending@fixture.invalid','000000',now()-interval '1 hour');
