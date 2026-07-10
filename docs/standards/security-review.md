# socialinsight Security Review Standard

Use this standard for all security and privacy review work in socialinsight. Security findings must distinguish confirmed vulnerabilities from suspected risks and cite relevant file paths.

## 1. Authentication

- Review login behavior.
- Review registration behavior.
- Review password hashing.
- Review token issuance.
- Review token verification.
- Review token expiry.
- Review refresh behavior.
- Review logout behavior.
- Review revocation behavior.
- Confirm authentication checks are server-side.

## 2. Authorization

- Confirm authorization is enforced server-side.
- Review ownership checks.
- Review role checks.
- Review object-level authorization.
- Review group permissions.
- Review private-account access.
- Confirm frontend visibility rules are not the only protection.

## 3. Identity Trust

- Never trust caller-supplied user identity when authenticated identity is available.
- Verify identity server-side.
- Review query, body, and path identity parameters.
- Ensure authenticated identity comes from verified auth middleware or equivalent server-side context.
- Treat `userId`, `currentUserId`, owner ids, actor ids, and group member ids as security-sensitive.

## 4. Privacy Enforcement

- Review feeds.
- Review search.
- Review profiles.
- Review followers.
- Review following.
- Review comments.
- Review poll results.
- Review groups.
- Review realtime events.
- Review notifications.
- Confirm private content and blocked-user rules are enforced across every access path.

## 5. Token Handling

- Review frontend token storage.
- Review token exposure in logs, URLs, errors, and local storage.
- Review expiry duration.
- Review revocation and logout behavior.
- Review replay risk.
- Review whether refresh tokens or session rotation are required.

## 6. OTP

- Review OTP generation.
- Review OTP expiration.
- Review replay behavior.
- Review attempt limits.
- Review abuse protection.
- Review fixed development codes.
- Review OTP logging.
- Ensure production OTP behavior cannot fall back to unsafe development behavior.

## 7. Input Validation

- Validate request bodies.
- Validate query parameters.
- Validate path parameters.
- Validate enum-like strings.
- Validate object IDs.
- Validate lengths.
- Validate formats.
- Reject unknown or unsupported values where security or data integrity depends on them.

## 8. File Uploads

- Review accepted file types.
- Review file and payload size limits.
- Review memory usage.
- Review image processing behavior.
- Review malicious content handling.
- Review metadata handling.
- Prefer bounded processing before expensive transformations.

## 9. Rate Limiting

- Review authentication endpoints.
- Review OTP endpoints.
- Review analytics ingestion.
- Review public APIs.
- Review sensitive actions such as follow, vote, comment, report, invite, and notification actions.
- Confirm rate limits are applied before expensive processing where practical.

## 10. Realtime And Socket Security

- Require authenticated socket handshake when user-specific rooms or events are used.
- Verify room membership server-side.
- Prevent user id spoofing.
- Review authorization for emitted events.
- Confirm private data is not sent to unauthenticated or incorrectly authorized sockets.

## 11. Data Exposure

- Review excessive response data.
- Review hidden private fields.
- Review logs.
- Review error messages.
- Review analytics payloads.
- Review notification payloads.
- Return only data needed by the client.

## 12. Search Privacy

- Use centralized privacy predicates where possible.
- Review group visibility.
- Review private account behavior.
- Review blocked-user behavior.
- Confirm search results do not bypass feed, profile, or group privacy rules.

## 13. Logging

- Do not log tokens.
- Do not log OTP codes.
- Do not log passwords.
- Do not log connection strings.
- Do not log secrets.
- Avoid logging unnecessary personal data.
- Redact sensitive values in reports and debugging output.

## 14. Secrets

- Never display secret values.
- Never copy environment values into documentation.
- Never commit secrets.
- Review environment variable usage without exposing values.
- Check source control and logs for accidental secret exposure when explicitly requested and permitted.

