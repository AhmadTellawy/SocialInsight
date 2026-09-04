import { type Page, type Route } from '@playwright/test';

export const PROFILE_ID = 'media-e2e-profile';
export const POST_ID = 'media-e2e-post';
export const POST_MEDIA_ID = 'media-e2e-post-image';

export type MockProfile = Record<string, unknown> & {
  id: string;
  name: string;
  handle: string;
  avatar: string;
  avatarMediaId: string | null;
  avatarMedia: Record<string, unknown> | null;
  updatedAt: string;
};

export type MediaMockState = {
  profile: MockProfile;
  post?: Record<string, unknown>;
  mediaPresentationCalls: number;
  uploadStartCalls: Array<Record<string, unknown>>;
  signedUploadCalls: number;
  prepareCalls: number;
  finalizeCalls: Array<Record<string, unknown>>;
  profileUpdateCalls: Array<Record<string, unknown>>;
  profileDetailReads: number;
  requestOrder: string[];
  failNextFinalize?: boolean;
  failNextProfileUpdate?: boolean;
};

export const makeProfile = (): MockProfile => ({
  id: PROFILE_ID,
  name: 'Media E2E Owner',
  handle: 'media_e2e_owner',
  avatar: '',
  avatarMediaId: null,
  avatarMedia: null,
  coverMediaId: null,
  coverMedia: null,
  bio: 'Local media test fixture',
  location: '',
  website: '',
  email: 'media-e2e@example.test',
  phone: '',
  language: 'en',
  birthday: '2000-09-02',
  profileLinks: [],
  updatedAt: '2026-09-04T00:00:00.000Z',
  country: 'Jordan',
  isPrivate: false,
  groupPrivacy: 'Public',
  peopleTagPermission: 'EVERYONE',
  demographics: { ageGroup: '25-34' },
  stats: { followers: 0, following: 0, posts: 0, responses: 0 },
});

export const makePost = (src: string, altText = 'Delayed post image'): Record<string, unknown> => ({
  id: POST_ID,
  title: 'Media loading regression fixture',
  description: 'The image frame must remain stable while the image loads and decodes.',
  type: 'Poll',
  status: 'PUBLISHED',
  options: [
    { id: 'option-a', text: 'A', votes: 0 },
    { id: 'option-b', text: 'B', votes: 0 },
  ],
  participants: 0,
  isTrending: false,
  likes: 0,
  commentsCount: 0,
  createdAt: '2026-09-04T00:00:00.000Z',
  author: {
    id: PROFILE_ID,
    name: 'Media E2E Owner',
    handle: 'media_e2e_owner',
    avatar: '',
    type: 'Personal',
  },
  media: [{
    id: POST_MEDIA_ID,
    access: 'PUBLIC',
    aspectRatio: 1.5,
    width: 1200,
    height: 800,
    src,
    altText,
  }],
});

export const makeState = (overrides: Partial<MediaMockState> = {}): MediaMockState => ({
  profile: makeProfile(),
  mediaPresentationCalls: 0,
  uploadStartCalls: [],
  signedUploadCalls: 0,
  prepareCalls: 0,
  finalizeCalls: [],
  profileUpdateCalls: [],
  profileDetailReads: 0,
  requestOrder: [],
  ...overrides,
});

const json = (route: Route, body: unknown, status = 200, headers: Record<string, string> = {}) => (
  route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) })
);

export async function installMockApp(page: Page, state: MediaMockState): Promise<void> {
  await page.addInitScript((profile) => {
    window.localStorage.setItem('si_token', 'media-e2e-token');
    window.localStorage.setItem('si_user', JSON.stringify(profile));
    window.localStorage.setItem('i18nextLng', 'en');
  }, state.profile);

  await page.route('**/__media_e2e_upload__/**', async (route) => {
    state.signedUploadCalls += 1;
    state.requestOrder.push('signed-upload');
    await route.fulfill({ status: 200, body: '' });
  });

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    const url = new URL(request.url());
    const pathname = url.pathname;

    if (method === 'GET' && pathname === `/api/posts/${POST_ID}` && state.post) {
      return json(route, state.post);
    }

    if (method === 'GET' && pathname === '/api/posts') {
      return json(route, { data: [], nextCursor: null });
    }

    if (method === 'GET' && pathname === '/api/users/me') {
      return json(route, state.profile, 200, { 'Cache-Control': 'private, no-store' });
    }

    if (method === 'GET' && pathname === `/api/users/${PROFILE_ID}`) {
      state.profileDetailReads += 1;
      return json(route, state.profile);
    }

    if (method === 'POST' && pathname === '/api/media/uploads') {
      const payload = request.postDataJSON() as Record<string, unknown>;
      state.uploadStartCalls.push(payload);
      state.requestOrder.push('upload-start');
      return json(route, {
        assetId: 'avatar-asset-1',
        bucket: 'media-e2e',
        path: 'avatar-asset-1',
        token: 'signed-media-e2e-token',
        signedUrl: `${url.origin}/__media_e2e_upload__/avatar-asset-1`,
        expiresInSeconds: 300,
      }, 201);
    }

    if (method === 'POST' && pathname === '/api/media/avatar-asset-1/finalize') {
      const payload = request.postDataJSON() as Record<string, unknown>;
      state.finalizeCalls.push(payload);
      state.requestOrder.push('finalize');
      if (state.failNextFinalize) {
        state.failNextFinalize = false;
        return json(route, { error: 'Temporary image processing failure', code: 'MEDIA_PROCESSING_FAILED' }, 503);
      }
      return json(route, { id: 'avatar-asset-1', aspectRatio: 1, width: 512, height: 512 });
    }

    if (method === 'POST' && pathname === '/api/media/avatar-asset-1/prepare') {
      state.prepareCalls += 1;
      state.requestOrder.push('prepare');
      return json(route, {
        id: 'avatar-asset-1',
        status: 'TEMPORARY',
        sourceMime: 'image/heic',
        preview: {
          src: '/pwa-192x192.png',
          mime: 'image/webp',
          width: 192,
          height: 192,
          aspectRatio: 1,
          expiresInSeconds: 300,
        },
      });
    }

    if (method === 'GET' && pathname === `/api/media/${POST_MEDIA_ID}`) {
      state.mediaPresentationCalls += 1;
      return json(route, {
        id: POST_MEDIA_ID,
        access: 'PUBLIC',
        aspectRatio: 1.5,
        width: 1200,
        height: 800,
        src: '/__media_e2e_images__/failure-2.png',
        altText: 'Delayed post image',
      });
    }

    if (method === 'GET' && pathname === '/api/media/avatar-asset-1') {
      return json(route, {
        id: 'avatar-asset-1',
        access: 'PUBLIC',
        aspectRatio: 1,
        width: 512,
        height: 512,
        src: '/pwa-192x192.png',
        altText: 'Media E2E Owner',
      });
    }

    if (method === 'PUT' && pathname === `/api/users/${PROFILE_ID}`) {
      const payload = request.postDataJSON() as Record<string, unknown>;
      state.profileUpdateCalls.push(payload);
      state.requestOrder.push('profile-update');
      if (state.failNextProfileUpdate) {
        state.failNextProfileUpdate = false;
        state.profile.updatedAt = '2026-09-04T00:00:02.000Z';
        return json(route, { error: 'Temporary profile update failure', code: 'PROFILE_UPDATE_FAILED' }, 503);
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'avatarMediaId')) {
        state.profile.avatarMediaId = payload.avatarMediaId as string | null;
        state.profile.avatarMedia = state.profile.avatarMediaId ? {
          id: state.profile.avatarMediaId,
          access: 'PUBLIC',
          aspectRatio: 1,
          width: 512,
          height: 512,
          src: '/pwa-192x192.png',
          altText: state.profile.name,
        } : null;
      }
      state.profile.updatedAt = '2026-09-04T00:00:01.000Z';
      return json(route, state.profile);
    }

    if (method === 'GET') {
      return json(route, []);
    }

    return route.fulfill({ status: 204, body: '' });
  });
}
