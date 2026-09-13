# Release blocker

The security implementation is complete and locally verified, but it is not deployed to production.

1. Audit point 26 explicitly requires a qualified independent human penetration test and retest on the exact candidate. Internal AI security review cannot substitute for that report.
2. No isolated representative backend exists for staging. The current Vercel rewrites send preview API, Socket and upload traffic to the Render production service, so branch previews remain disabled.
3. Production Vercel and Render are verified at revision `689b64dfba705f29a2a635fa5abff937745dc4fb`; the security candidate is `2062cabd25ff8517db96bb5e297ae36706ff1eb1`.

Required release sequence:

1. Push the exact candidate to the trusted repository after the external-action approval control accepts the remote.
2. Deploy the same candidate to an isolated backend/frontend staging target with isolated database, media storage and mail behavior.
3. Run the qualified external penetration test, remediate any material finding and obtain a retest closure report.
4. Re-run affected gates on the resulting exact commit.
5. Execute the authorized Vercel and Render production release, verify migrations and live revision, run non-destructive smoke checks, observe health/errors/latency, and roll back on defined triggers.
