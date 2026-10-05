-- Supabase auto-enables RLS on legacy tables. The former owner connection
-- bypassed it, while the dedicated runtime login correctly does not. Preserve
-- server-authoritative legacy authorization with a backend-only policy, rather
-- than disabling RLS, making the login an owner, or granting public API access.
-- Pages keep their signed actor-specific policies. Migration history and
-- verifier/admission tables are deliberately excluded from this finite list.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

DO $legacy_backend$
DECLARE
  table_name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'socialinsight_runtime' AND NOT rolcanlogin
      AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole) THEN
    RAISE EXCEPTION 'HOSTED_LEGACY_RUNTIME_GROUP_UNSAFE';
  END IF;
  FOREACH table_name IN ARRAY ARRAY[
    'Answer', 'Comment', 'CommentHashtag', 'CommentLike', 'Group', 'GroupMember',
    'Hashtag', 'InteractionEvent', 'MediaAsset', 'MediaPrivacyTransition',
    'MediaVariant', 'Mention', 'MentionOccurrence', 'NotificationSettings',
    'Option', 'Post', 'PostHashtag', 'PostMedia', 'PostTaggedUser', 'Question',
    'Response', 'Section', 'UserLike', '_PostTargetGroups', 'follows',
    'notifications', 'post_views', 'profile_links', 'push_subscriptions',
    'reports', 'user_blocks', 'user_demographics', 'user_hidden_posts',
    'user_saved_posts', 'users'
  ]
  LOOP
    IF pg_catalog.to_regclass(pg_catalog.format('public.%I', table_name)) IS NULL THEN
      RAISE EXCEPTION 'HOSTED_LEGACY_REQUIRED_TABLE_MISSING:%', table_name;
    END IF;
    EXECUTE pg_catalog.format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE pg_catalog.format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE pg_catalog.format('DROP POLICY IF EXISTS socialinsight_runtime_legacy_all ON public.%I', table_name);
    EXECUTE pg_catalog.format(
      'CREATE POLICY socialinsight_runtime_legacy_all ON public.%I FOR ALL TO socialinsight_runtime USING (true) WITH CHECK (true)',
      table_name
    );
  END LOOP;
END
$legacy_backend$;

RESET statement_timeout;
RESET lock_timeout;
