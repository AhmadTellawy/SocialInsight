import type { Express } from 'express';

// Render terminates public connections at its proxy. Trust exactly that nearest
// hop so IP-keyed limiters do not collapse all visitors into one proxy bucket.
// Local/direct deployments continue to ignore client-supplied forwarding headers.
export function configureProxyTrust(app: Express, render = process.env.RENDER): void {
  if (render === 'true') app.set('trust proxy', 1);
}
