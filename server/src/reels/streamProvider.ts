import { createHmac, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { REEL_MAX_SECONDS, ReelError } from './reelPolicy';

export function reelsConfigured(): boolean {
  return process.env.REELS_ENABLED === 'true' && ['STREAM_ACCOUNT_ID', 'STREAM_API_TOKEN', 'STREAM_SIGNING_KEY_ID', 'STREAM_SIGNING_KEY_PEM', 'STREAM_CUSTOMER_CODE', 'STREAM_WEBHOOK_SECRET'].every(key => Boolean(process.env[key]));
}
// Turning off a feature must not suspend deletion/retention of its existing data.
export function videoMaintenanceConfigured(): boolean {
  return Boolean(process.env.STREAM_ACCOUNT_ID && process.env.STREAM_API_TOKEN);
}
export function requireReels(): void {
  if (!reelsConfigured()) throw new ReelError('REELS_UNAVAILABLE', 'Reels are not available yet.', 503);
}
const endpoint = () => `https://api.cloudflare.com/client/v4/accounts/${process.env.STREAM_ACCOUNT_ID}/stream`;
async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(endpoint() + path, { ...init, signal: AbortSignal.timeout(15_000), headers: { Authorization: `Bearer ${process.env.STREAM_API_TOKEN}`, ...init.headers } });
  if (!response.ok && !(init.method === 'DELETE' && response.status === 404)) throw new ReelError('VIDEO_PROVIDER_UNAVAILABLE', 'Video service is temporarily unavailable. Try again.', 503);
  return response;
}
export const streamProvider = {
  async createUpload(bytes: number, creator: string, expires: Date) {
    const metadata = Object.entries({ maxDurationSeconds: String(REEL_MAX_SECONDS), requiresignedurls: '', expiry: expires.toISOString() }).map(([k, v]) => v ? `${k} ${Buffer.from(v).toString('base64')}` : k).join(',');
    const response = await request('?direct_user=true', { method: 'POST', headers: { 'Tus-Resumable': '1.0.0', 'Upload-Length': String(bytes), 'Upload-Metadata': metadata, 'Upload-Creator': creator } });
    const uploadUrl = response.headers.get('Location');
    const providerId = response.headers.get('stream-media-id');
    if (!uploadUrl || !providerId || !/^[a-f0-9]{32}$/i.test(providerId)) throw new ReelError('VIDEO_PROVIDER_RESPONSE', 'Unable to prepare video upload.', 503);
    const url = new URL(uploadUrl);
    if (url.protocol !== 'https:' || !['upload.videodelivery.net', 'upload.cloudflarestream.com'].includes(url.hostname)) throw new ReelError('VIDEO_PROVIDER_RESPONSE', 'Invalid video upload destination.', 503);
    return { providerId, uploadUrl };
  },
  async inspect(id: string) { const json = await (await request(`/${encodeURIComponent(id)}`)).json() as any; return json.result; },
  async remove(id: string) { await request(`/${encodeURIComponent(id)}`, { method: 'DELETE' }); },
  async findUpload(creator: string) {
    const json = await (await request(`?creator=${encodeURIComponent(creator)}&limit=10`)).json() as any;
    return Array.isArray(json.result) ? json.result.filter((video: any) => video.creator === creator) : [];
  },
  playback(id: string) {
    const expiresAt = Math.floor(Date.now() / 1000) + 300;
    const key = Buffer.from(process.env.STREAM_SIGNING_KEY_PEM!, 'base64').toString('utf8');
    const token = jwt.sign({ sub: id, kid: process.env.STREAM_SIGNING_KEY_ID, exp: expiresAt, nbf: Math.floor(Date.now() / 1000) - 10 }, key, { algorithm: 'RS256', keyid: process.env.STREAM_SIGNING_KEY_ID });
    const base = `https://customer-${process.env.STREAM_CUSTOMER_CODE}.cloudflarestream.com/${token}`;
    return { hls: `${base}/manifest/video.m3u8`, poster: `${base}/thumbnails/thumbnail.jpg?time=1s`, expiresAt: expiresAt * 1000 };
  }
};

export function verifyStreamWebhook(body: Buffer, header: string | undefined, secret = process.env.STREAM_WEBHOOK_SECRET, now = Date.now()): boolean {
  if (!header || !secret) return false;
  const values = Object.fromEntries(header.split(',').map(pair => pair.trim().split('=')));
  if (!/^\d+$/.test(values.time || '') || !/^[a-f0-9]{64}$/i.test(values.sig1 || '') || Math.abs(now / 1000 - Number(values.time)) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${values.time}.`).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(values.sig1, 'hex'));
}
