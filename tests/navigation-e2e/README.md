# Isolated application navigation coverage

Runs the real application through Playwright with synthetic users, posts and groups. Every API request is intercepted; unhandled API endpoints fail fixture teardown. WebSockets and all third-party browser requests are blocked. Tests create no server data, use a new browser context per case and need no database cleanup.

Before the first run, download the same public Tailwind runtime used by the application into the ignored local fixture:

```powershell
New-Item -ItemType Directory -Force tests/navigation-e2e/assets | Out-Null
Invoke-WebRequest https://cdn.tailwindcss.com/3.4.17 -OutFile tests/navigation-e2e/assets/tailwind.js
npm.cmd run build
npx.cmd playwright test --config=playwright.navigation.config.ts
```

Alternatively set `NAVIGATION_TAILWIND` to an existing Tailwind 3.4.17 browser runtime file. Port 4175 must be free. The config starts and stops its own production preview server; it never reuses an unidentified service. A fresh build of the exact tested source is required before running the suite. Production assets avoid development-server transform delays while exercising the same bundle that is deployed. Chromium must be installed through the repository's existing Playwright setup.

Coverage includes English and Arabic mobile and English desktop, canonical profile and group links, all implemented settings subpages, nested profile links, app Back, browser Back/Forward, reload, profile/group tabs, analytics, malformed paths and direct-entry fallback. Assertions verify rendered state as well as URLs. Existing `playwright.profile.config.ts` separately covers dirty editor and save/discard behavior.

This is frontend integration evidence. It does not establish real backend authorization, production deployment or physical iOS/Android behavior. Failure traces and screenshots are stored in the ignored `results/` directory.

For the malformed `/post/%E0%A4%A` router-guard case, the fixture serves the unchanged built `dist/index.html` at the requested URL. Vite's preview middleware otherwise throws while decoding that URL before the application loads. This isolates the application guard; it does not verify the hosting server's handling of malformed URL encoding.
