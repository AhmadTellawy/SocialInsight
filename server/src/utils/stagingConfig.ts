import type { Express } from 'express';

// Staging-only controls. Existing Production/main session and proxy defaults
// are deliberately unchanged by this release.
export const configureStaging = (app: Express, env: NodeJS.ProcessEnv = process.env): void => {
    const stagingMarked = env.DEPLOYMENT_ENV?.toLowerCase().includes('staging')
        || env.STAGING_RELEASE_SHA !== undefined
        || env.RENDER_GIT_BRANCH === 'codex/otp-resend-production';
    if (!stagingMarked) return;
    const fail = (): never => { throw new Error('Staging isolation configuration is invalid'); };
    if (env.DEPLOYMENT_ENV !== 'staging') fail();
    const ref = env.STAGING_DATABASE_PROJECT_REF || '';
    // Provisioned free Staging project, not an arbitrary self-consistent URL.
    if (ref !== 'mnfiixtgnlzmduunfryt') fail();
    let url: URL;
    try { url = new URL(env.DATABASE_URL || ''); } catch { return fail(); }
    if (url.protocol !== 'postgresql:' || !url.password || url.port !== '5432'
        || url.searchParams.get('sslmode') !== 'require'
        || url.searchParams.get('sslaccept') !== 'strict') fail();
    const direct = url.hostname === `db.${ref}.supabase.co` && url.username === 'otp_staging_app';
    const pooler = url.hostname.endsWith('.pooler.supabase.com') && url.username === `otp_staging_app.${ref}`;
    if (!direct && !pooler) fail();
    // Prisma tooling may need this alias at build time. It may NEVER contain
    // the migration/admin credential in the web service's environment.
    if (env.DIRECT_URL !== undefined && env.DIRECT_URL !== env.DATABASE_URL) fail();
    let frontend: URL;
    try { frontend = new URL(env.CLIENT_URL || ''); } catch { return fail(); }
    const approvedFrontend = 'https://social-insight-git-code-a8f10e-ahmad-husseins-projects-97b8d8be.vercel.app';
    if (frontend.origin !== approvedFrontend || frontend.username || frontend.password
        || frontend.pathname !== '/' || frontend.search || frontend.hash) fail();
    if (!/^[a-f0-9]{40}$/.test(env.STAGING_RELEASE_SHA || '')
        || env.RENDER_GIT_COMMIT !== env.STAGING_RELEASE_SHA
        || env.RENDER_GIT_BRANCH !== 'codex/otp-resend-production') fail();
    const hops = env.STAGING_TRUST_PROXY_HOPS || '0';
    if (!/^[0-5]$/.test(hops)) fail();
    app.set('trust proxy', Number(hops));
};
