const fs = require('node:fs');
const { performance } = require('node:perf_hooks');

const target = (process.env.BENCHMARK_BASE_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const runs = Math.max(1, Math.min(10, Number(process.env.BENCHMARK_RUNS || 3)));
const timeoutMs = Math.max(1_000, Number(process.env.BENCHMARK_TIMEOUT_MS || 30_000));
const authStatePath = process.env.BENCHMARK_AUTH_STATE || '../tests/e2e/.auth/public_creator.json';

const percentile = (values, ratio) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
};

const parseAuthState = () => {
  const state = JSON.parse(fs.readFileSync(authStatePath, 'utf8'));
  const origin = (state.origins || []).find((entry) =>
    (entry.localStorage || []).some((item) => item.name === 'si_token')
  );
  if (!origin) throw new Error('No authenticated origin exists in the supplied storage state.');

  const read = (name) => (origin.localStorage || []).find((item) => item.name === name)?.value;
  let token = read('si_token');
  const rawUser = read('si_user');
  if (!token || !rawUser) throw new Error('The supplied storage state is missing si_token or si_user.');

  const user = JSON.parse(rawUser);
  if (!user?.id) throw new Error('The authenticated storage state has no user id.');
  if (process.env.BENCHMARK_LOCAL_JWT === '1') {
    require('dotenv').config({ path: process.env.BENCHMARK_ENV_FILE || '.env' });
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) throw new Error('JWT_SECRET is required for a local authenticated benchmark.');
    token = require('jsonwebtoken').sign({ userId: user.id }, jwtSecret, { expiresIn: '10m' });
  }
  return { token, userId: user.id };
};

const request = async (path, token) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();
  try {
    const response = await fetch(`${target}${path}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        'accept-encoding': 'gzip, br'
      },
      signal: controller.signal
    });
    const body = await response.text();
    return {
      status: response.status,
      durationMs: performance.now() - startedAt,
      bytes: Buffer.byteLength(body),
      body
    };
  } finally {
    clearTimeout(timeout);
  }
};

const safeJson = (body) => {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
};

const main = async () => {
  const { token, userId } = parseAuthState();
  const seedFeed = await request('/api/posts?limit=10', token);
  const feedPayload = safeJson(seedFeed.body);
  const posts = Array.isArray(feedPayload) ? feedPayload : (feedPayload?.data || []);
  const seedPost = posts.find((post) => post?.id);

  const seedGroups = await request(`/api/users/${encodeURIComponent(userId)}/groups?limit=20`, token);
  const groupPayload = safeJson(seedGroups.body);
  const groups = Array.isArray(groupPayload) ? groupPayload : (groupPayload?.data || []);
  let seedGroup = groups.find((group) => group?.id);
  if (!seedGroup) {
    const directoryResponse = await request('/api/groups', token);
    const directoryPayload = safeJson(directoryResponse.body);
    const directoryGroups = Array.isArray(directoryPayload)
      ? directoryPayload
      : (directoryPayload?.data || []);
    seedGroup = directoryGroups.find((group) => group?.id);
  }

  const endpoints = [
    ['feed', '/api/posts?limit=10'],
    ['account', `/api/users/${encodeURIComponent(userId)}`],
    ['account_current', '/api/users/me'],
    ['profile_analytics', `/api/users/${encodeURIComponent(userId)}/analytics`],
    ['followers', `/api/users/${encodeURIComponent(userId)}/followers`],
    ['following', `/api/users/${encodeURIComponent(userId)}/following`],
    ['account_groups', `/api/users/${encodeURIComponent(userId)}/groups?limit=20`],
    ['suggested_accounts', `/api/users/${encodeURIComponent(userId)}/suggested`],
    ['notifications', `/api/users/${encodeURIComponent(userId)}/notifications?limit=20`],
    ['notification_settings', '/api/notification-settings'],
    ['drafts', `/api/posts/drafts?userId=${encodeURIComponent(userId)}`],
    ['saved_posts', `/api/posts/saved?userId=${encodeURIComponent(userId)}`],
    ['groups_directory', '/api/groups'],
    ['trends', '/api/posts/trends?period=24h&type=all&limit=10'],
    ['trending_hashtags', '/api/hashtags/trending?limit=10'],
    ['search', '/api/search?q=a']
  ];

  if (seedPost?.id) {
    const postId = encodeURIComponent(seedPost.id);
    endpoints.push(
      ['post_detail', `/api/posts/${postId}`],
      ['comments', `/api/posts/${postId}/comments`],
      ['post_likers', `/api/posts/${postId}/likes`],
      ['participants', `/api/posts/${postId}/participants`],
      ['post_results', `/api/posts/${postId}/results`],
      ['post_analytics', `/api/posts/${postId}/analytics`]
    );
  }

  if (seedGroup?.id) {
    const groupId = encodeURIComponent(seedGroup.id);
    endpoints.push(
      ['group_detail', `/api/groups/${groupId}`],
      ['group_membership', `/api/groups/${groupId}/membership`],
      ['group_stats', `/api/groups/${groupId}/stats`],
      ['group_members', `/api/groups/${groupId}/members?page=1&limit=20`],
      ['group_feed', `/api/posts?groupId=${groupId}&limit=10`],
      ['group_posts', `/api/groups/${groupId}/posts?page=1&limit=10`]
    );
  }

  const results = [];
  for (const [name, path] of endpoints) {
    const samples = [];
    let status = 0;
    let bytes = 0;
    let error = null;
    for (let run = 0; run < runs; run += 1) {
      try {
        const result = await request(path, token);
        status = result.status;
        bytes = result.bytes;
        samples.push(result.durationMs);
      } catch (requestError) {
        error = requestError?.name === 'AbortError' ? 'timeout' : 'request_failed';
        break;
      }
    }
    results.push({
      name,
      status,
      runs: samples.length,
      minMs: samples.length ? Math.round(Math.min(...samples) * 10) / 10 : null,
      p50Ms: samples.length ? Math.round(percentile(samples, 0.5) * 10) / 10 : null,
      maxMs: samples.length ? Math.round(Math.max(...samples) * 10) / 10 : null,
      bytes,
      error
    });
  }

  process.stdout.write(`${JSON.stringify({ target, runs, measuredAt: new Date().toISOString(), results }, null, 2)}\n`);
};

main().catch((error) => {
  process.stderr.write(`Benchmark failed: ${error?.message || 'unknown error'}\n`);
  process.exitCode = 1;
});
