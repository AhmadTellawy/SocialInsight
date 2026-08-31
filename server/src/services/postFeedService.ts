import { Prisma } from '@prisma/client';

export const DEFAULT_FEED_LIMIT = 10;
export const MAX_FEED_LIMIT = 30;

const FEED_CURSOR_PREFIX = 'feed_v1_';

export type FeedCursor = {
  id: string;
  createdAt: Date;
};

export const parseFeedLimit = (value: unknown): number => {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_FEED_LIMIT;
  return Math.min(parsed, MAX_FEED_LIMIT);
};

export const encodeFeedCursor = ({ id, createdAt }: FeedCursor): string => {
  const payload = Buffer.from(JSON.stringify({ v: 1, id, createdAt: createdAt.toISOString() }), 'utf8')
    .toString('base64url');
  return `${FEED_CURSOR_PREFIX}${payload}`;
};

export const decodeFeedCursor = (value: unknown): FeedCursor | null => {
  if (typeof value !== 'string' || !value.startsWith(FEED_CURSOR_PREFIX)) return null;

  try {
    const decoded = JSON.parse(
      Buffer.from(value.slice(FEED_CURSOR_PREFIX.length), 'base64url').toString('utf8')
    );
    const createdAt = new Date(decoded?.createdAt);
    if (decoded?.v !== 1 || typeof decoded?.id !== 'string' || !decoded.id || Number.isNaN(createdAt.getTime())) {
      return null;
    }
    return { id: decoded.id, createdAt };
  } catch {
    return null;
  }
};

export const isOpaqueFeedCursor = (value: unknown): boolean =>
  typeof value === 'string' && value.startsWith(FEED_CURSOR_PREFIX);

export const buildFeedCursorWhere = ({ id, createdAt }: FeedCursor): Prisma.PostWhereInput => ({
  OR: [
    { createdAt: { lt: createdAt } },
    {
      AND: [
        { createdAt: { equals: createdAt } },
        { id: { lt: id } }
      ]
    }
  ]
});

const FEED_POST_SCALAR_SELECT = {
  id: true,
  title: true,
  description: true,
  type: true,
  authorId: true,
  groupId: true,
  isTrending: true,
  expiresAt: true,
  image: true,
  mediaAspectRatio: true,
  likesCount: true,
  commentsCount: true,
  responseCount: true,
  category: true,
  targetAudience: true,
  pollChoiceType: true,
  imageLayout: true,
  optionPresentation: true,
  showOptionNames: true,
  createdAt: true,
  updatedAt: true,
  targetGroups: true,
  sharedFromId: true,
  sharedCaption: true,
  status: true,
  currentStep: true,
  demographics: true,
  allowAnonymous: true,
  forceAnonymous: true,
  allowComments: true,
  allowMultipleSelection: true,
  allowUserOptions: true,
  randomPairing: true,
  resultsWho: true,
  resultsDetail: true,
  resultsTiming: true,
  deletedAt: true,
  isDeleted: true,
  sharesCount: true,
  visibility: true,
  approvedById: true,
  approvedAt: true,
  rejectedById: true,
  rejectedAt: true,
  rejectionReason: true,
  viewCount: true,
  uniqueViewCount: true
} as const;

export const buildFeedPostScalarSelect = (): Prisma.PostSelect => FEED_POST_SCALAR_SELECT;

export type FeedRelationBundle = {
  users: any[];
  sections: any[];
  questions: any[];
  options: any[];
  mentions: any[];
  mentionOccurrences: any[];
  tags: any[];
  postMedia: any[];
  mediaAssets: any[];
  mediaVariants: any[];
  targetGroups: Array<{ postId: string; group: any }>;
  responses: any[];
  answers: any[];
  likes: any[];
  shares: Array<{ id: string; sharedFromId: string | null }>;
  savedPosts: any[];
  follows: Array<{ followerId: string; followingId: string }>;
};

const emptyBundle = (): FeedRelationBundle => ({
  users: [],
  sections: [],
  questions: [],
  options: [],
  mentions: [],
  mentionOccurrences: [],
  tags: [],
  postMedia: [],
  mediaAssets: [],
  mediaVariants: [],
  targetGroups: [],
  responses: [],
  answers: [],
  likes: [],
  shares: [],
  savedPosts: [],
  follows: []
});

/**
 * Loads every relation needed by a feed page in one PostgreSQL statement. The
 * result stays flat here and is stitched below, avoiding Prisma's default one
 * statement per nested relation level (which is especially costly remotely).
 */
export const loadFeedRelationBundle = async (
  client: any,
  postIds: string[],
  viewerId?: string,
  guestId?: string
): Promise<FeedRelationBundle> => {
  if (postIds.length === 0) return emptyBundle();

  const requestedValues = Prisma.join(postIds.map((id) => Prisma.sql`(${id}::text)`));
  const tagVisibility = viewerId
    ? Prisma.sql`(
        pt."status" = 'ACCEPTED'::"PeopleTagStatus"
        OR (
          pt."status" = 'PENDING'::"PeopleTagStatus"
          AND (pt."taggedUserId" = ${viewerId} OR pt."taggedByUserId" = ${viewerId})
        )
      )`
    : Prisma.sql`pt."status" = 'ACCEPTED'::"PeopleTagStatus"`;
  const responseIdentity = viewerId
    ? Prisma.sql`r."userId" = ${viewerId}`
    : guestId
      ? Prisma.sql`r."guestId" = ${guestId}`
      : Prisma.sql`FALSE`;
  const authenticatedLike = viewerId
    ? Prisma.sql`ul."userId" = ${viewerId}`
    : Prisma.sql`FALSE`;
  const authenticatedShare = viewerId
    ? Prisma.sql`shared."authorId" = ${viewerId}`
    : Prisma.sql`FALSE`;
  const authenticatedSaved = viewerId
    ? Prisma.sql`saved."user_id" = ${viewerId}`
    : Prisma.sql`FALSE`;
  const authenticatedFollow = viewerId
    ? Prisma.sql`f."follower_id" = ${viewerId} AND f."status" = 'ACTIVE'`
    : Prisma.sql`FALSE`;
  const targetGroupVisibility = viewerId
    ? Prisma.sql`(
        EXISTS (
          SELECT 1
          FROM feed_post_refs post_ref
          WHERE post_ref."id" = relation."B"
            AND post_ref."authorId" = ${viewerId}
        )
        OR (
          target_group."isDeleted" = FALSE
          AND (
            target_group."isPublic" = TRUE
            OR EXISTS (
              SELECT 1
              FROM "GroupMember" membership
              WHERE membership."groupId" = target_group."id"
                AND membership."userId" = ${viewerId}
                AND membership."status" = 'JOINED'
            )
          )
        )
      )`
    : Prisma.sql`target_group."isDeleted" = FALSE AND target_group."isPublic" = TRUE`;

  const rows = await client.$queryRaw(Prisma.sql`
    WITH requested_ids("id") AS (
      VALUES ${requestedValues}
    ),
    feed_post_refs AS (
      SELECT p."id", p."authorId"
      FROM "Post" p
      INNER JOIN requested_ids requested ON requested."id" = p."id"
    ),
    feed_sections AS (
      SELECT section.*
      FROM "Section" section
      WHERE section."postId" IN (SELECT "id" FROM requested_ids)
    ),
    feed_questions AS (
      SELECT question.*
      FROM "Question" question
      WHERE question."postId" IN (SELECT "id" FROM requested_ids)
         OR question."sectionId" IN (SELECT "id" FROM feed_sections)
    ),
    feed_options AS (
      SELECT option.*
      FROM "Option" option
      WHERE option."questionId" IN (SELECT "id" FROM feed_questions)
    ),
    feed_mentions AS (
      SELECT mention.*
      FROM "Mention" mention
      WHERE mention."postId" IN (SELECT "id" FROM requested_ids)
        AND mention."state" = 'ACTIVE'::"MentionState"
    ),
    feed_occurrences AS (
      SELECT occurrence.*
      FROM "MentionOccurrence" occurrence
      WHERE occurrence."mentionId" IN (SELECT "id" FROM feed_mentions)
    ),
    feed_tags AS (
      SELECT pt.*
      FROM "PostTaggedUser" pt
      WHERE pt."postId" IN (SELECT "id" FROM requested_ids)
        AND ${tagVisibility}
    ),
    feed_post_media AS (
      SELECT pm.*
      FROM "PostMedia" pm
      WHERE pm."postId" IN (SELECT "id" FROM requested_ids)
    ),
    feed_users AS (
      SELECT u.*
      FROM "users" u
      WHERE u."id" IN (
        SELECT "authorId" FROM feed_post_refs
        UNION
        SELECT "targetUserId" FROM feed_mentions
        UNION
        SELECT "taggedUserId" FROM feed_tags
      )
    ),
    feed_media_asset_ids("id") AS (
      SELECT u."avatar_media_id" FROM feed_users u WHERE u."avatar_media_id" IS NOT NULL
      UNION
      SELECT pm."mediaAssetId" FROM feed_post_media pm
      UNION
      SELECT question."imageMediaId" FROM feed_questions question WHERE question."imageMediaId" IS NOT NULL
      UNION
      SELECT option."imageMediaId" FROM feed_options option WHERE option."imageMediaId" IS NOT NULL
    ),
    feed_media_assets AS (
      SELECT asset.*
      FROM "MediaAsset" asset
      WHERE asset."id" IN (SELECT "id" FROM feed_media_asset_ids)
    ),
    feed_media_variants AS (
      SELECT variant.*
      FROM "MediaVariant" variant
      WHERE variant."mediaAssetId" IN (SELECT "id" FROM feed_media_asset_ids)
    ),
    feed_target_groups AS (
      SELECT
        relation."B" AS "postId",
        jsonb_build_object('id', target_group."id") AS "group"
      FROM "_PostTargetGroups" relation
      INNER JOIN "Group" target_group ON target_group."id" = relation."A"
      WHERE relation."B" IN (SELECT "id" FROM requested_ids)
        AND ${targetGroupVisibility}
    ),
    feed_responses AS (
      SELECT DISTINCT ON (r."postId") r.*
      FROM "Response" r
      WHERE r."postId" IN (SELECT "id" FROM requested_ids)
        AND ${responseIdentity}
      ORDER BY r."postId", r."timestamp" DESC, r."id" DESC
    ),
    feed_answers AS (
      SELECT answer.*
      FROM "Answer" answer
      WHERE answer."responseId" IN (SELECT "id" FROM feed_responses)
    ),
    feed_likes AS (
      SELECT ul.*
      FROM "UserLike" ul
      WHERE ul."postId" IN (SELECT "id" FROM requested_ids)
        AND ${authenticatedLike}
    ),
    feed_shares AS (
      SELECT shared."id", shared."sharedFromId"
      FROM "Post" shared
      WHERE shared."sharedFromId" IN (SELECT "id" FROM requested_ids)
        AND ${authenticatedShare}
    ),
    feed_saved AS (
      SELECT
        saved."user_id" AS "userId",
        saved."post_id" AS "postId",
        saved."created_at" AS "createdAt"
      FROM "user_saved_posts" saved
      WHERE saved."post_id" IN (SELECT "id" FROM requested_ids)
        AND ${authenticatedSaved}
    ),
    feed_follows AS (
      SELECT f."follower_id" AS "followerId", f."following_id" AS "followingId"
      FROM "follows" f
      WHERE f."following_id" IN (SELECT "authorId" FROM feed_post_refs)
        AND ${authenticatedFollow}
    )
    SELECT jsonb_build_object(
      'users', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', u."id",
          'name', u."name",
          'handle', u."handle",
          'avatar', u."avatar",
          'avatarMediaId', u."avatar_media_id",
          'verifiedBadge', u."verified_badge",
          'isPrivate', u."is_private"
        ))
        FROM feed_users u
      ), '[]'::jsonb),
      'sections', COALESCE((SELECT jsonb_agg(to_jsonb(section)) FROM feed_sections section), '[]'::jsonb),
      'questions', COALESCE((SELECT jsonb_agg(to_jsonb(question)) FROM feed_questions question), '[]'::jsonb),
      'options', COALESCE((SELECT jsonb_agg(to_jsonb(option)) FROM feed_options option), '[]'::jsonb),
      'mentions', COALESCE((SELECT jsonb_agg(to_jsonb(mention)) FROM feed_mentions mention), '[]'::jsonb),
      'mentionOccurrences', COALESCE((SELECT jsonb_agg(to_jsonb(occurrence)) FROM feed_occurrences occurrence), '[]'::jsonb),
      'tags', COALESCE((SELECT jsonb_agg(to_jsonb(tag)) FROM feed_tags tag), '[]'::jsonb),
      'postMedia', COALESCE((SELECT jsonb_agg(to_jsonb(pm)) FROM feed_post_media pm), '[]'::jsonb),
      'mediaAssets', COALESCE((SELECT jsonb_agg(to_jsonb(asset)) FROM feed_media_assets asset), '[]'::jsonb),
      'mediaVariants', COALESCE((SELECT jsonb_agg(to_jsonb(variant)) FROM feed_media_variants variant), '[]'::jsonb),
      'targetGroups', COALESCE((SELECT jsonb_agg(to_jsonb(target_group)) FROM feed_target_groups target_group), '[]'::jsonb),
      'responses', COALESCE((SELECT jsonb_agg(to_jsonb(response)) FROM feed_responses response), '[]'::jsonb),
      'answers', COALESCE((SELECT jsonb_agg(to_jsonb(answer)) FROM feed_answers answer), '[]'::jsonb),
      'likes', COALESCE((SELECT jsonb_agg(to_jsonb(feed_like)) FROM feed_likes feed_like), '[]'::jsonb),
      'shares', COALESCE((SELECT jsonb_agg(to_jsonb(share)) FROM feed_shares share), '[]'::jsonb),
      'savedPosts', COALESCE((SELECT jsonb_agg(to_jsonb(saved)) FROM feed_saved saved), '[]'::jsonb),
      'follows', COALESCE((SELECT jsonb_agg(to_jsonb(follow_row)) FROM feed_follows follow_row), '[]'::jsonb)
    ) AS "bundle"
  `) as Array<{ bundle: FeedRelationBundle }>;

  const bundle = rows[0]?.bundle;
  return bundle && typeof bundle === 'object' ? bundle : emptyBundle();
};

const groupBy = <T>(items: T[], key: (item: T) => string | null | undefined): Map<string, T[]> => {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const value = key(item);
    if (!value) continue;
    const existing = grouped.get(value) || [];
    existing.push(item);
    grouped.set(value, existing);
  }
  return grouped;
};

const numericOrder = (left: any, right: any): number => (left?.order ?? 0) - (right?.order ?? 0);

/** Rebuilds the nested shape consumed by the existing feed serializer. */
export const attachFeedContentRelations = <T extends Record<string, any>>(
  posts: T[],
  bundle: FeedRelationBundle
): T[] => {
  const variantsByAsset = groupBy(bundle.mediaVariants, (variant) => variant.mediaAssetId);
  const mediaById = new Map(bundle.mediaAssets.map((asset) => [asset.id, {
    ...asset,
    variants: variantsByAsset.get(asset.id) || []
  }]));
  const usersById = new Map(bundle.users.map((user) => [user.id, {
    ...user,
    avatarMedia: user.avatarMediaId ? mediaById.get(user.avatarMediaId) || null : null
  }]));

  const optionsByQuestion = groupBy(bundle.options, (option) => option.questionId);
  for (const options of optionsByQuestion.values()) options.sort(numericOrder);
  const questions = bundle.questions.map((question) => ({
    ...question,
    imageMedia: question.imageMediaId ? mediaById.get(question.imageMediaId) || null : null,
    options: (optionsByQuestion.get(question.id) || []).map((option) => ({
      ...option,
      imageMedia: option.imageMediaId ? mediaById.get(option.imageMediaId) || null : null
    }))
  }));
  const questionsByPost = groupBy(questions, (question) => question.postId);
  const questionsBySection = groupBy(questions, (question) => question.sectionId);
  for (const postQuestions of questionsByPost.values()) postQuestions.sort(numericOrder);
  for (const sectionQuestions of questionsBySection.values()) sectionQuestions.sort(numericOrder);

  const sectionsByPost = groupBy(bundle.sections.map((section) => ({
    ...section,
    questions: questionsBySection.get(section.id) || []
  })), (section) => section.postId);
  for (const sections of sectionsByPost.values()) sections.sort(numericOrder);

  const occurrencesByMention = groupBy(bundle.mentionOccurrences, (occurrence) => occurrence.mentionId);
  for (const occurrences of occurrencesByMention.values()) {
    occurrences.sort((left: any, right: any) =>
      String(left.surface).localeCompare(String(right.surface)) || left.startOffset - right.startOffset
    );
  }
  const mentionsByPost = groupBy(bundle.mentions.map((mention) => ({
    ...mention,
    targetUser: usersById.get(mention.targetUserId),
    occurrences: occurrencesByMention.get(mention.id) || []
  })), (mention) => mention.postId);

  const tagsByPost = groupBy(bundle.tags.map((tag) => ({
    ...tag,
    taggedUser: usersById.get(tag.taggedUserId)
  })), (tag) => tag.postId);
  for (const tags of tagsByPost.values()) {
    tags.sort((left: any, right: any) => String(left.createdAt).localeCompare(String(right.createdAt)));
  }

  const postMediaByPost = groupBy(bundle.postMedia.map((attachment) => ({
    ...attachment,
    mediaAsset: mediaById.get(attachment.mediaAssetId)
  })), (attachment) => attachment.postId);
  for (const attachments of postMediaByPost.values()) {
    attachments.sort((left: any, right: any) => left.sortOrder - right.sortOrder);
  }
  const targetGroupsByPost = groupBy(bundle.targetGroups, (target) => target.postId);

  const attach = (post: Record<string, any> | null | undefined) => {
    if (!post) return;
    post.author = usersById.get(post.authorId);
    post.questions = questionsByPost.get(post.id) || [];
    post.sections = sectionsByPost.get(post.id) || [];
    post.mentions = mentionsByPost.get(post.id) || [];
    post.taggedUsers = tagsByPost.get(post.id) || [];
    post.media = postMediaByPost.get(post.id) || [];
    post.targetedGroups = (targetGroupsByPost.get(post.id) || []).map((target) => target.group);
    attach(post.sharedFrom);
  };

  posts.forEach(attach);
  return posts;
};

export type FeedViewerStateRows = Pick<FeedRelationBundle,
  'responses' | 'answers' | 'likes' | 'shares' | 'savedPosts' | 'follows'
> & {
  hasResponseIdentity: boolean;
  userId?: string;
};

/** Attach the same viewer-state arrays the old nested Prisma include exposed. */
export const attachFeedViewerState = <T extends Record<string, any>>(
  posts: T[],
  state: FeedViewerStateRows
): T[] => {
  const answersByResponse = groupBy(state.answers, (answer: any) => answer.responseId);
  const responseByPost = new Map<string, Record<string, any>>();
  const newestResponses = [...state.responses].sort((left: any, right: any) =>
    String(right.timestamp || '').localeCompare(String(left.timestamp || ''))
      || String(right.id || '').localeCompare(String(left.id || ''))
  );
  for (const response of newestResponses) {
    if (!responseByPost.has(response.postId)) {
      responseByPost.set(response.postId, {
        ...response,
        answers: answersByResponse.get(response.id) || []
      });
    }
  }
  const likeByPost = new Map(state.likes.map((like) => [like.postId, like]));
  const shareByPost = new Map(
    state.shares
      .filter((share): share is { id: string; sharedFromId: string } => Boolean(share.sharedFromId))
      .map((share) => [share.sharedFromId, share])
  );
  const savedByPost = new Map(state.savedPosts.map((saved) => [saved.postId, saved]));
  const followedAuthors = new Set(state.follows.map((follow) => follow.followingId));

  const attach = (post: Record<string, any> | null | undefined) => {
    if (!post) return;
    if (state.hasResponseIdentity) {
      const response = responseByPost.get(post.id);
      post.responses = response ? [response] : [];
    }
    if (state.userId) {
      const like = likeByPost.get(post.id);
      const share = shareByPost.get(post.id);
      const saved = savedByPost.get(post.id);
      post.likes = like ? [like] : [];
      post.shares = share ? [share] : [];
      post.savedBy = saved ? [saved] : [];
      if (post.author) {
        post.author.following = followedAuthors.has(post.author.id)
          ? [{ followerId: state.userId }]
          : [];
      }
    }
    attach(post.sharedFrom);
  };

  posts.forEach(attach);
  return posts;
};
