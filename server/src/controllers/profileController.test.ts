import assert from 'node:assert/strict';
import test from 'node:test';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'profile-controller-test-secret';

const prisma = require('../prisma').default as typeof import('../prisma').default;
const { getMe, getUser, updateUser } = require('./userController') as typeof import('./userController');

const createResponse = () => {
  const state: { statusCode: number; body: any; headers: Record<string, string> } = {
    statusCode: 200,
    body: undefined,
    headers: {}
  };
  const response: any = {
    status(code: number) { state.statusCode = code; return response; },
    json(body: any) { state.body = body; return response; },
    setHeader(name: string, value: string) { state.headers[name] = value; return response; }
  };
  return { response, state };
};

const profileRecord = (isPrivate: boolean) => ({
  id: 'profile-1',
  name: 'Profile User',
  handle: 'profile_user',
  avatar: null,
  avatarMediaId: null,
  avatarMedia: null,
  coverMediaId: null,
  coverMedia: null,
  bio: 'Bio',
  location: null,
  website: null,
  isPrivate,
  mediaPrivacyTarget: null,
  groupPrivacy: 'Public',
  peopleTagPermission: 'EVERYONE',
  verifiedBadge: false,
  followersCount: 2,
  followingCount: 3,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-31T00:00:00.000Z'),
  country: null,
  language: 'en',
  status: 'ACTIVE',
  profileMentions: [],
  profileLinks: [],
  // These extra values prove the response sanitizer stays safe even if a query is widened later.
  email: 'private@example.com',
  phone: '+10000000000',
  birthday: new Date('2000-02-29T00:00:00.000Z'),
  passwordHash: 'secret'
});

test('public profile DTO never exposes DOB/contact fields and hides private links from a guest', async () => {
  const originals = {
    userFindUnique: prisma.user.findUnique,
    demographicsFindUnique: prisma.userDemographics.findUnique,
    postCount: prisma.post.count,
    responseCount: prisma.response.count,
    linkFindMany: prisma.profileLink.findMany
  };
  let linkReads = 0;
  try {
    (prisma.user as any).findUnique = async (args: any) => args.select?.profileMentions
      ? profileRecord(true)
      : { isPrivate: true, mediaPrivacyTarget: null };
    (prisma.userDemographics as any).findUnique = async () => null;
    (prisma.post as any).count = async () => 0;
    (prisma.response as any).count = async () => 0;
    (prisma.profileLink as any).findMany = async () => { linkReads += 1; return []; };

    const { response, state } = createResponse();
    await getUser({ params: { id: 'profile-1' } } as any, response);

    assert.equal(state.statusCode, 200);
    assert.equal(linkReads, 0);
    assert.deepEqual(state.body.profileLinks, []);
    assert.equal(state.body.coverMedia, null);
    for (const key of ['birthday', 'email', 'phone', 'passwordHash', 'mediaPrivacyTarget']) {
      assert.equal(Object.prototype.hasOwnProperty.call(state.body, key), false, key);
    }
  } finally {
    (prisma.user as any).findUnique = originals.userFindUnique;
    (prisma.userDemographics as any).findUnique = originals.demographicsFindUnique;
    (prisma.post as any).count = originals.postCount;
    (prisma.response as any).count = originals.responseCount;
    (prisma.profileLink as any).findMany = originals.linkFindMany;
  }
});

test('public accounts expose links but a blocked viewer receives a non-enumerating 404', async () => {
  const originals = {
    userFindUnique: prisma.user.findUnique,
    blockFindFirst: prisma.userBlock.findFirst,
    followFindUnique: prisma.follow.findUnique,
    demographicsFindUnique: prisma.userDemographics.findUnique,
    postCount: prisma.post.count,
    responseCount: prisma.response.count,
    linkFindMany: prisma.profileLink.findMany
  };
  try {
    (prisma.user as any).findUnique = async (args: any) => args.select?.profileMentions
      ? profileRecord(false)
      : { isPrivate: false, mediaPrivacyTarget: null };
    (prisma.userBlock as any).findFirst = async () => null;
    (prisma.follow as any).findUnique = async () => null;
    (prisma.userDemographics as any).findUnique = async () => null;
    (prisma.post as any).count = async () => 0;
    (prisma.response as any).count = async () => 0;
    (prisma.profileLink as any).findMany = async () => [{
      id: 'link-1', title: 'Website', url: 'https://example.com/#home', normalizedUrl: 'https://example.com/', sortOrder: 0,
      createdAt: new Date(), updatedAt: new Date()
    }];

    const publicResponse = createResponse();
    await getUser({ params: { id: 'profile-1' } } as any, publicResponse.response);
    assert.equal(publicResponse.state.body.profileLinks.length, 1);
    assert.equal(publicResponse.state.body.profileLinks[0].normalizedUrl, 'https://example.com/');

    (prisma.userBlock as any).findFirst = async () => ({ blockerId: 'viewer-1' });
    const blockedResponse = createResponse();
    await getUser({ params: { id: 'profile-1' }, user: { userId: 'viewer-1' } } as any, blockedResponse.response);
    assert.equal(blockedResponse.state.statusCode, 404);
    assert.deepEqual(blockedResponse.state.body, { error: 'User not found' });
  } finally {
    (prisma.user as any).findUnique = originals.userFindUnique;
    (prisma.userBlock as any).findFirst = originals.blockFindFirst;
    (prisma.follow as any).findUnique = originals.followFindUnique;
    (prisma.userDemographics as any).findUnique = originals.demographicsFindUnique;
    (prisma.post as any).count = originals.postCount;
    (prisma.response as any).count = originals.responseCount;
    (prisma.profileLink as any).findMany = originals.linkFindMany;
  }
});

test('/me returns a date-only birthday privately with no-store caching', async () => {
  const originals = {
    userFindUnique: prisma.user.findUnique,
    demographicsFindUnique: prisma.userDemographics.findUnique,
    postCount: prisma.post.count,
    responseCount: prisma.response.count
  };
  try {
    (prisma.user as any).findUnique = async () => profileRecord(true);
    (prisma.userDemographics as any).findUnique = async () => null;
    (prisma.post as any).count = async () => 0;
    (prisma.response as any).count = async () => 0;

    const { response, state } = createResponse();
    await getMe({ user: { userId: 'profile-1' } } as any, response);
    assert.equal(state.body.birthday, '2000-02-29');
    assert.equal(state.headers['Cache-Control'], 'private, no-store');
    assert.equal(Object.prototype.hasOwnProperty.call(state.body, 'email'), false);
  } finally {
    (prisma.user as any).findUnique = originals.userFindUnique;
    (prisma.userDemographics as any).findUnique = originals.demographicsFindUnique;
    (prisma.post as any).count = originals.postCount;
    (prisma.response as any).count = originals.responseCount;
  }
});

test('cover replacement requires the optimistic profile version before media is attached', async () => {
  const originalUserFindUnique = prisma.user.findUnique;
  try {
    (prisma.user as any).findUnique = async () => ({
      avatar: null,
      avatarMediaId: null,
      coverMediaId: null,
      birthday: null,
      isPrivate: false,
      mediaPrivacyTarget: null,
      updatedAt: new Date('2026-08-31T00:00:00.000Z')
    });
    const { response, state } = createResponse();
    await updateUser({
      params: { id: 'profile-1' },
      user: { userId: 'profile-1' },
      body: { coverMediaId: 'new-cover' }
    } as any, response);
    assert.equal(state.statusCode, 428);
    assert.equal(state.body.code, 'PROFILE_VERSION_REQUIRED');
  } finally {
    (prisma.user as any).findUnique = originalUserFindUnique;
  }
});
