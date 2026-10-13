# Post response sheet checks

Run from the checkout root:

```powershell
npm.cmd exec --no -- playwright test --config playwright.post-response-sheet.config.ts
```

The fixture renders the production SurveyCard, SurveyQuestion and BottomSheet components with synthetic post data. It records calls to the existing vote callback, including anonymity and follow-up payloads. Its Vite server handles every /api/ request locally; no production credentials or database are needed.

Coverage: text/image choices, 320/390/1280 widths, English/Arabic, results, private/expired posts, callback failure and retry, multiple selection and text preservation, custom answers, browser Back, media carousel position, portrait preview, hidden option names, repost target, surveys, quizzes, challenges, ratings, nested anonymous/demographic sheets, touch swipe, and unchanged inline/share-capture modes.

These are frontend integration checks. They do not replace live authenticated backend or deployment verification. Generated reports/screenshots stay ignored under this directory.
