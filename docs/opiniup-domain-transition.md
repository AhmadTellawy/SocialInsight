# Opiniup identity and domain transition

Status: founder-approved identity; local implementation, NOT a domain cutover or deployment.

The founder approved **Opiniup**, **opiniup.com**, and **Opiniup <no-reply@opiniup.com>** as the intended replacement identity. This supersedes prior brand/sender decisions, not historical evidence or infrastructure identities. The product remains the same opinion, poll and insight platform.

## Configuration contract

| Setting | Intended value / rule | Activation prerequisite |
| --- | --- | --- |
| Product/PWA/email display name | Opiniup | Tested, reviewed release |
| Primary public origin | https://opiniup.com | Verified domain ownership, hosting, TLS and authorized cutover |
| EMAIL_FROM_NAME | Opiniup | Sender verification complete |
| EMAIL_FROM_ADDRESS | no-reply@opiniup.com | Verified opiniup.com domain in Resend |
| RESEND_API_KEY | Independent Staging Sending-access key restricted to opiniup.com | Do not reuse or broaden the old-domain key; store only in isolated secret manager |
| VITE_PUBLIC_URL | Current environment's verified frontend origin | Staging must use its own Preview origin, never the future public origin |
| VITE_API_URL | Current environment's verified API plus /api | Preview must point exclusively at isolated Staging API |
| CLIENT_URL | Exact verified frontend origin for the environment | Preserve existing Stage allowlist until any new Stage hostname is reviewed and pinned |
| VAPID_SUBJECT | mailto:privacy@opiniup.com (intended contact) | Provision and verify the mailbox before activating this contact |

The code continues requiring all three email variables; it does not silently fall back to an unverified sender. Runtime Render sender values have NOT been changed by this document. The current domain-restricted old key cannot authorize the new domain. Do not request, print or commit key values.

## Remaining external work — not performed

1. Verify ownership of opiniup.com in the actual registrar account. Read-only NS observation on 2026-09-06 returned dns1.registrar-servers.com and dns2.registrar-servers.com; this is not ownership proof.
2. Add and verify the new domain in Resend, using exact provider-generated DNS records. Do not guess DKIM/SPF values or create multiple SPF records. Review DMARC without altering the old domain or existing mail routing.
3. Provision privacy@opiniup.com or a verified forwarding mailbox before publishing the new privacy contact. Domain purchase does not create a mailbox. Stop before any paid plan.
4. Configure a separate domain-restricted Staging key and sender only once verified; retain the empty allowlist and persistent one-message limit. No real email during setup.
5. Complete the existing default-ACL recovery and credential-logging security gates before migration or Stage app deployment. Branding does not waive them.
6. Use one reviewed SHA for retained backup/migration/backend/frontend. Verify Stage-only routing, TLS, CORS, delivery and user-entered OTP before requesting a later Production release.
7. Keep public-domain binding, redirects from the old domain, production environment variables and DNS cutover pending explicit Production authorization. No main merge in this task.

## Compatibility and exclusions

- Preserve database/project/service IDs, migration names/history, session/JWT behavior, storage keys, package identifiers, log filenames, immutable historical reports and existing security target restrictions. These are technical identities, not user-facing branding.
- Existing health response text and operational scripts remain compatible. Existing broad E2E Production targets are not repointed or executed; local mock OTP/Profile configurations are used.
- Preserve the current verified Preview hostname and fixed Stage database identity. Tests reject both old and new public domains as Stage frontend targets.
- The graphical icon contains no brand word and is retained; no logo redesign is implied.
- The privacy screen changes brand/contact text only. No processing purpose, legal terms, consent, or publication is changed. Contact readiness and applicable publication review remain release gates.
- A domain move changes browser origin: existing local storage, cookies and installed PWAs do not automatically transfer. Do not promise seamless cross-domain login, copy tokens in URLs, or replace session architecture. Keep the old domain operating until a separately reviewed transition.

## Rollback

Before cutover, revert only this task's reviewed brand diff if required; preserve all user changes. No database rollback is needed because there is no schema/data change. After a separately authorized cutover, restore the recorded prior per-environment configuration/domain binding, preserving DNS evidence and both domains. Never weaken Staging isolation or reuse Production credentials to make rollback work.
