# Post UI browser harness

Run `npx.cmd playwright test --config=playwright.post-ui.config.ts` from the repository root.

This harness mounts the production SurveyCard, SurveyQuestion, MediaCarousel and all four creation forms. It uses local SVG fixtures and mock option state so that geometry, text direction, responsive layout and result presentation can be verified without a backend account. It does not prove server vote persistence or production deployment.

The main matrix covers 390, 768 and 1280 CSS pixels, LTR/RTL document directions and horizontal image, vertical image and text choices. Each option contains first-strong Arabic or English text preceded by punctuation/numbers. Assertions inspect computed font size and alignment, label overflow, full-bleed post media, keyboard carousel behavior, the single-image state and post-vote percentages. Additional cases exercise a Chromium CDP touch swipe, private results/hidden names, all four composers at 320 CSS pixels, and nested Survey/Quiz question images.

Before/after option screenshots and supplemental screenshots are saved under `results/` for visual inspection. The fixture follows the application's current Tailwind CDN approach and therefore requires the CDN to be reachable. This is a Chromium rendering check; it does not cover Safari or physical devices.
