# Isolated post option regression

The suite navigates the real App with synthetic actors and an API route allowlist. It uses fresh browser contexts, blocks service workers and WebSockets, aborts external traffic, and fails on unexpected API calls. It never reads a storageState file or contacts a real backend/database. Static external fonts/images are deliberately blocked; screenshots use locally available fonts.

Start the candidate Vite server on loopback port 4189 with `/api` as its API URL. Then run:

```powershell
node node_modules/@playwright/test/cli.js test -c playwright.post-options.config.ts
```

Optional `POST_OPTIONS_BASE_URL` must still name localhost; `POST_OPTIONS_CHROMIUM` can select an existing Chromium executable. No dependency installation or web server is started by this config. Reports, route-call attachments, failure traces, and localized report screenshots go into `tests/post-options-e2e/results/`.

Set `POST_OPTIONS_RESULTS` to retain separate run evidence. Main App tests can run on the production build via Vite preview (`--grep-invert "real hook"`); the supplemental actual-hook harness uses Vite dev (`--grep "real hook"`). The same source snapshot must back both servers for final evidence. Set TEMP/TMP to a task-only scratch directory on a drive with adequate space.

Serve the public Tailwind runtime used by the application locally by setting `POST_OPTIONS_TAILWIND` to its downloaded file (default: `tests/post-options-e2e/assets/tailwind.js`). The browser route fulfills this single script from disk. Record the source URL and hash in run evidence; do not commit the vendored runtime. Other external fonts/images are aborted.

The three projects cover Arabic/English at 390px and English at 1280px. Tests prove frontend orchestration against simulated server outcomes. They do not prove live deployment, real server authorization, real private-account access, database cleanup, or OS share-sheet integration; independent backend and release evidence remains necessary.
