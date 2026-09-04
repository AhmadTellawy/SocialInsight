import { createHash, randomBytes } from 'crypto';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import fetch from 'node-fetch';
import prisma from '../prisma';
import { hashSessionSecret } from './sessionService';

export type OAuthProvider = 'GOOGLE' | 'FACEBOOK';
export type OAuthMode = 'LOGIN' | 'LINK';

export interface OAuthStartResult {
    authorizationUrl: string;
    browserSecret: string;
    maxAgeSeconds: number;
}

export class OAuthError extends Error {
    constructor(public readonly code: string, message = 'OAuth authentication failed') { super(message); }
}

interface ProviderIdentity {
    provider: OAuthProvider;
    providerAccountId: string;
    email: string | null;
    emailVerified: boolean;
    name: string;
}

const db = prisma as any;
const stateTtlMs = (): number => {
    const seconds = Number.parseInt(process.env.OAUTH_STATE_TTL_SECONDS || '', 10);
    return Math.max(120, Math.min(900, Number.isFinite(seconds) ? seconds : 600)) * 1000;
};
const providerTimeoutMs = (): number => {
    const parsed = Number.parseInt(process.env.OAUTH_PROVIDER_TIMEOUT_MS || '', 10);
    return Number.isFinite(parsed) ? Math.max(1_000, Math.min(30_000, parsed)) : 10_000;
};
const googleClient = (config: { clientId: string; clientSecret: string; redirectUri: string }): OAuth2Client => new OAuth2Client({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: config.redirectUri,
    transporterOptions: { timeout: providerTimeoutMs() }
});
const providerFetchJson = async (url: string, options: Parameters<typeof fetch>[1]): Promise<{ response: Awaited<ReturnType<typeof fetch>>; body: any }> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), providerTimeoutMs());
    timer.unref?.();
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        const body = await response.json();
        return { response, body };
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw new OAuthError('OAUTH_PROVIDER_TIMEOUT');
        throw error;
    } finally {
        clearTimeout(timer);
    }
};
const normalizeEmail = (email: unknown): string | null => typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    ? email.trim().toLowerCase()
    : null;

const providerConfig = (provider: OAuthProvider) => {
    if (provider === 'GOOGLE') {
        const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
        const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
        const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim();
        if (!clientId || !clientSecret || !redirectUri) throw new OAuthError('OAUTH_NOT_CONFIGURED');
        return { clientId, clientSecret, redirectUri };
    }
    const clientId = process.env.FACEBOOK_APP_ID?.trim();
    const clientSecret = process.env.FACEBOOK_APP_SECRET?.trim();
    const redirectUri = process.env.FACEBOOK_OAUTH_REDIRECT_URI?.trim();
    if (!clientId || !clientSecret || !redirectUri) throw new OAuthError('OAUTH_NOT_CONFIGURED');
    return { clientId, clientSecret, redirectUri };
};

const hashOAuthState = (state: string, browserSecret: string): string =>
    hashSessionSecret(`oauth-state:${state}:${browserSecret}`);

export const beginOAuth = async (provider: OAuthProvider, mode: OAuthMode, linkingUserId?: string): Promise<OAuthStartResult> => {
    if (mode === 'LINK' && !linkingUserId) throw new OAuthError('AUTH_REQUIRED');
    const config = providerConfig(provider);
    const state = randomBytes(32).toString('base64url');
    const browserSecret = randomBytes(32).toString('base64url');
    const nonce = randomBytes(32).toString('base64url');
    let verifier: string;
    let authorizationUrl: string;

    if (provider === 'GOOGLE') {
        const client = googleClient(config);
        const pkce = await client.generateCodeVerifierAsync();
        verifier = pkce.codeVerifier;
        authorizationUrl = client.generateAuthUrl({
            scope: ['openid', 'email', 'profile'],
            state,
            nonce,
            code_challenge: pkce.codeChallenge,
            code_challenge_method: CodeChallengeMethod.S256,
            prompt: 'select_account'
        });
    } else {
        verifier = randomBytes(48).toString('base64url');
        const codeChallenge = createHash('sha256').update(verifier).digest('base64url');
        const params = new URLSearchParams({
            client_id: config.clientId,
            redirect_uri: config.redirectUri,
            state,
            response_type: 'code',
            scope: 'email,public_profile',
            code_challenge: codeChallenge,
            code_challenge_method: 'S256'
        });
        authorizationUrl = `https://www.facebook.com/v23.0/dialog/oauth?${params.toString()}`;
    }

    await db.oAuthState.create({
        data: {
            stateHash: hashOAuthState(state, browserSecret),
            provider,
            pkceVerifier: verifier,
            nonce,
            mode,
            linkingUserId: linkingUserId || null,
            expiresAt: new Date(Date.now() + stateTtlMs())
        }
    });
    return { authorizationUrl, browserSecret, maxAgeSeconds: Math.floor(stateTtlMs() / 1000) };
};

const consumeState = async (provider: OAuthProvider, state: string, browserSecret: string): Promise<any> => {
    if (!state || state.length > 256 || !browserSecret || browserSecret.length < 32 || browserSecret.length > 256) {
        throw new OAuthError('OAUTH_STATE_INVALID');
    }
    const stateHash = hashOAuthState(state, browserSecret);
    const record = await db.oAuthState.findUnique({ where: { stateHash } });
    if (!record || record.provider !== provider || record.consumedAt || record.expiresAt <= new Date()) {
        throw new OAuthError('OAUTH_STATE_INVALID');
    }
    const consumed = await db.oAuthState.updateMany({
        where: { id: record.id, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: new Date() }
    });
    if (consumed.count !== 1) throw new OAuthError('OAUTH_STATE_INVALID');
    return record;
};

const googleIdentity = async (code: string, stateRecord: any): Promise<ProviderIdentity> => {
    const config = providerConfig('GOOGLE');
    const client = googleClient(config);
    const tokens = await client.getToken({ code, codeVerifier: stateRecord.pkceVerifier, redirect_uri: config.redirectUri });
    if (!tokens.tokens.id_token) throw new OAuthError('OAUTH_IDENTITY_INVALID');
    const ticket = await client.verifyIdToken({ idToken: tokens.tokens.id_token, audience: config.clientId });
    const payload = ticket.getPayload() as any;
    if (!payload?.sub || payload.nonce !== stateRecord.nonce || payload.email_verified !== true) {
        throw new OAuthError('OAUTH_IDENTITY_INVALID');
    }
    return {
        provider: 'GOOGLE',
        providerAccountId: payload.sub,
        email: normalizeEmail(payload.email),
        emailVerified: true,
        name: typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim().slice(0, 100) : 'Social Insight User'
    };
};

const facebookIdentity = async (code: string, stateRecord: any): Promise<ProviderIdentity> => {
    const config = providerConfig('FACEBOOK');
    const tokenBodyRequest = new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        code,
        code_verifier: stateRecord.pkceVerifier
    });
    const { response: tokenResponse, body: tokenBody } = await providerFetchJson('https://graph.facebook.com/v23.0/oauth/access_token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: tokenBodyRequest.toString()
    });
    if (!tokenResponse.ok || typeof tokenBody.access_token !== 'string') throw new OAuthError('OAUTH_TOKEN_EXCHANGE_FAILED');

    const { response: debugResponse, body: debugBody } = await providerFetchJson('https://graph.facebook.com/debug_token', {
        method: 'POST',
        headers: {
            'content-type': 'application/x-www-form-urlencoded',
            authorization: `Bearer ${config.clientId}|${config.clientSecret}`
        },
        body: new URLSearchParams({ input_token: tokenBody.access_token }).toString()
    });
    if (!debugResponse.ok || debugBody.data?.is_valid !== true || debugBody.data?.app_id !== config.clientId || !debugBody.data?.user_id) {
        throw new OAuthError('OAUTH_IDENTITY_INVALID');
    }

    const profileUrl = new URL(`https://graph.facebook.com/v23.0/${encodeURIComponent(debugBody.data.user_id)}`);
    profileUrl.search = new URLSearchParams({ fields: 'id,name,email' }).toString();
    const { response: profileResponse, body: profile } = await providerFetchJson(profileUrl.toString(), {
        method: 'GET',
        headers: { authorization: `Bearer ${tokenBody.access_token}` }
    });
    if (!profileResponse.ok || profile.id !== debugBody.data.user_id) throw new OAuthError('OAUTH_IDENTITY_INVALID');
    return {
        provider: 'FACEBOOK',
        providerAccountId: profile.id,
        email: normalizeEmail(profile.email),
        emailVerified: false,
        name: typeof profile.name === 'string' && profile.name.trim() ? profile.name.trim().slice(0, 100) : 'Social Insight User'
    };
};

const uniqueHandle = async (name: string): Promise<string> => {
    const stem = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20) || 'user';
    for (let attempt = 0; attempt < 8; attempt += 1) {
        const suffix = randomBytes(4).toString('hex');
        const handle = `${stem}_${suffix}`;
        if (!await db.user.findUnique({ where: { handle }, select: { id: true } })) return handle;
    }
    throw new OAuthError('OAUTH_ACCOUNT_CREATE_FAILED');
};

const resolveIdentity = async (identity: ProviderIdentity, stateRecord: any): Promise<any> => {
    // Only a provider assertion that explicitly verifies the address may become
    // the canonical Social Insight email or participate in email-collision
    // decisions. Facebook's basic profile email has no equivalent verified bit.
    const trustedEmail = identity.emailVerified ? identity.email : null;
    const linked = await db.oAuthAccount.findFirst({
        where: { provider: identity.provider, providerAccountId: identity.providerAccountId }
    });

    if (stateRecord.mode === 'LINK') {
        if (!stateRecord.linkingUserId) throw new OAuthError('AUTH_REQUIRED');
        if (linked && linked.userId !== stateRecord.linkingUserId) throw new OAuthError('OAUTH_ACCOUNT_CONFLICT');
        const providerLink = await db.oAuthAccount.findFirst({
            where: { userId: stateRecord.linkingUserId, provider: identity.provider }
        });
        if (providerLink && providerLink.providerAccountId !== identity.providerAccountId) {
            throw new OAuthError('OAUTH_PROVIDER_ALREADY_LINKED');
        }
        if (trustedEmail) {
            const emailOwner = await db.user.findFirst({ where: { email: { equals: trustedEmail, mode: 'insensitive' } }, select: { id: true } });
            if (emailOwner && emailOwner.id !== stateRecord.linkingUserId) throw new OAuthError('OAUTH_ACCOUNT_CONFLICT');
        }
        if (!linked) {
            await db.oAuthAccount.create({ data: { userId: stateRecord.linkingUserId, provider: identity.provider, providerAccountId: identity.providerAccountId, emailSnapshot: identity.email } });
        }
        return db.user.findUnique({ where: { id: stateRecord.linkingUserId } });
    }

    if (linked) return db.user.findUnique({ where: { id: linked.userId } });
    if (trustedEmail) {
        const emailOwner = await db.user.findFirst({ where: { email: { equals: trustedEmail, mode: 'insensitive' } }, select: { id: true } });
        if (emailOwner) throw new OAuthError('ACCOUNT_LINK_REQUIRED');
    }

    const handle = await uniqueHandle(identity.name);
    return db.$transaction(async (tx: any) => {
        const user = await tx.user.create({
            data: {
                name: identity.name,
                handle,
                email: trustedEmail,
                emailVerifiedAt: trustedEmail ? new Date() : null,
                authProvider: identity.provider === 'GOOGLE' ? 'Google' : 'Facebook'
            }
        });
        await tx.oAuthAccount.create({ data: { userId: user.id, provider: identity.provider, providerAccountId: identity.providerAccountId, emailSnapshot: identity.email } });
        await tx.notificationSettings.create({
            data: {
                userId: user.id,
                settings: JSON.stringify({
                    myPosts: { likes: 'everyone', comments: 'everyone', shares: 'following' },
                    sharedPosts: { likes: 'following', comments: 'following', shares: 'off' },
                    toggles: { activityFollowed: true, invitations: true, commentInteractions: true, newFollowers: true, emailNotifications: false }
                })
            }
        });
        return user;
    });
};

export const completeOAuth = async (
    provider: OAuthProvider,
    code: string,
    state: string,
    browserSecret: string,
    callbackSessionUserId?: string
): Promise<{ user: any; mode: OAuthMode }> => {
    if (!code || code.length > 2048) throw new OAuthError('OAUTH_CODE_INVALID');
    const stateRecord = await consumeState(provider, state, browserSecret);
    if (stateRecord.mode === 'LINK' && (!callbackSessionUserId || callbackSessionUserId !== stateRecord.linkingUserId)) {
        throw new OAuthError('OAUTH_LINK_SESSION_INVALID');
    }
    try {
        const identity = provider === 'GOOGLE' ? await googleIdentity(code, stateRecord) : await facebookIdentity(code, stateRecord);
        const user = await resolveIdentity(identity, stateRecord);
        if (!user || user.status !== 'ACTIVE') throw new OAuthError('AUTH_ACCOUNT_INACTIVE');
        return { user, mode: stateRecord.mode };
    } catch (error) {
        if (error instanceof OAuthError) throw error;
        throw new OAuthError('OAUTH_AUTHENTICATION_FAILED');
    }
};
