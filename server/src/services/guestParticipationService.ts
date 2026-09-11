import { randomBytes } from 'crypto';
import { Request, Response } from 'express';
import { hashSessionSecret, readCookies } from './sessionService';

export const GUEST_PROOF_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const secureCookie = () => process.env.NODE_ENV === 'production' || process.env.AUTH_COOKIE_SECURE === 'true';
export const guestCookieName = () => secureCookie() ? '__Host-si_guest_participation' : 'si_guest_participation';
export type GuestParticipationProof = { token: string; hash: string; expiresAt: Date };

export const readGuestParticipationHash = (req: Request): string | null => {
  if (!req.headers?.cookie) return null;
  const token = readCookies(req)[guestCookieName()];
  return token && /^[a-f0-9]{64}$/.test(token) ? hashSessionSecret(`guest-participation:${token}`) : null;
};
export const prepareGuestParticipationProof = (req: Request): GuestParticipationProof => {
  const supplied = readCookies(req)[guestCookieName()];
  const token = supplied && /^[a-f0-9]{64}$/.test(supplied) ? supplied : randomBytes(32).toString('hex');
  return { token, hash: hashSessionSecret(`guest-participation:${token}`), expiresAt: new Date(Date.now() + GUEST_PROOF_TTL_MS) };
};
export const writeGuestParticipationCookie = (res: Response, proof: GuestParticipationProof): void => {
  res.cookie(guestCookieName(), proof.token, { httpOnly: true, secure: secureCookie(), sameSite: 'lax', path: '/', maxAge: GUEST_PROOF_TTL_MS });
};
export const guestProofMatches = (response: { guestProofHash: string | null; guestProofExpiresAt: Date | null }, hash: string | null): boolean =>
  Boolean(hash && response.guestProofHash === hash && response.guestProofExpiresAt && response.guestProofExpiresAt.getTime() > Date.now());
