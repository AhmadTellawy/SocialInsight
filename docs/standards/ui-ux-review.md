# socialinsight UI/UX Review Standard

Use this standard for UI and UX review work in socialinsight. Distinguish code-level review from browser evidence, exploratory review, and product judgment.

## Mandatory Review Criteria

1. Mobile-first behavior: verify primary flows work on small screens before desktop polish.
2. Information hierarchy: confirm the most important actions and content are visually clear.
3. Visual consistency: review spacing, typography, color usage, icons, components, and states.
4. Navigation consistency: confirm users can move between related screens predictably.
5. Interaction consistency: review repeated controls, gestures, and action placement.
6. Feedback: confirm actions provide clear progress, success, and failure feedback.
7. Forms: review labels, inputs, grouping, submission, cancellation, and recovery.
8. Validation feedback: confirm invalid input is explained near the relevant field.
9. Cognitive load: reduce unnecessary steps, confusing choices, and overloaded screens.
10. Accessibility: review semantic structure, contrast, labels, focus states, and assistive technology needs.
11. Touch targets: confirm interactive controls are large enough and spaced for touch.
12. Responsive behavior: review layout across mobile, tablet, and desktop widths.
13. Image handling: review upload, preview, crop, aspect ratio, loading, failure, and fallback behavior.
14. Aspect ratios: preserve expected media, card, poll, and chart proportions.
15. Long content: review wrapping, truncation, scrolling, expansion, and overflow.
16. Poll option layouts: review readability, result display, vote state, and long option text.
17. Loading states: confirm loading is clear and does not imply failure.
18. Error states: confirm errors are actionable and safe.
19. Empty states: confirm empty screens guide the next useful action.
20. Success states: confirm successful actions are visible and not misleading.
21. Disabled states: confirm unavailable controls explain or imply why they are unavailable.
22. RTL: review right-to-left layout behavior where Arabic is used.
23. LTR: review left-to-right layout behavior where English is used.
24. Arabic: review text fit, translation quality, directionality, and mixed-content behavior.
25. English: review wording, consistency, and truncation.
26. Keyboard behavior: review tab order, focus trapping, shortcuts, and form submission where relevant.
27. Modal/dialog behavior: review focus, escape/cancel, scrolling, backdrop, and nested actions.
28. PWA/mobile behavior: review install, offline, update, push permission, notification click, and mobile viewport behavior where applicable.

## Review Evidence Types

### A. Code-Level UX Review

Code-level UX review is based on source code and implementation structure. It can identify likely UX risks, missing states, inconsistent props, hard-coded text, layout constraints, and accessibility gaps.

Do not present code-level UX findings as browser-confirmed visual defects.

### B. Browser-Based Visual Review

Browser-based visual review requires actual rendered application evidence. It should use screenshots or direct browser inspection where possible.

Only browser-based review can confirm visible overlap, clipping, color contrast in context, viewport-specific layout defects, and real rendered spacing.

### C. Exploratory UX Review

Exploratory UX review requires interacting with realistic user journeys. It should include navigation, form entry, error recovery, repeated actions, and unexpected states.

Exploratory review can identify friction that is not obvious from code or screenshots.

### D. Product Judgment

Product judgment covers recommendations that require human or product-owner decision. Examples include prioritization, tone, workflow preference, feature scope, and tradeoffs between simplicity and power.

Never present a product preference as a confirmed defect.

