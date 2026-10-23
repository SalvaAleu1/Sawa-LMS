# SawaLearn release checklist

## Before any pilot
- [ ] Confirm target Supabase project and review every migration.
- [ ] Configure Auth URL allowlist, email templates, rate limits and MFA policy.
- [ ] Apply tenant-scoped RLS policies and test cross-tenant denial with real user JWTs.
- [ ] Configure Worker secrets outside Git; confirm no service-role key reaches browser bundles.
- [ ] Configure R2 bucket, private-by-default access, signed upload/download and malware/file-type controls.
- [ ] Implement and test platform-owner bootstrap and one-time first-admin invitation flow.
- [ ] Test manual cash receipt confirmation, subscription dates, 7-day grace and owner-only termination/extension.
- [ ] Test 80/90/100% capacity notifications and ensure existing access is not cut off.
- [ ] Test blocked new activations/uploads at capacity and archive-with-history workflow.
- [ ] Configure email retries, idempotency keys, delivery logs and institution timezone.
- [ ] Enable database backups; rehearse a restore and tenant-specific export.
- [ ] Add error monitoring, uptime checks, audit review and incident response contacts.
- [ ] Run typecheck, build, unit tests, RLS integration tests, accessibility checks and load tests.
- [ ] Verify keyboard navigation, mobile layouts, low-bandwidth operation and screen-reader labels.
- [ ] Verify transcript QR tokens cannot expose personal records without authorized verification.
- [ ] Complete privacy notice, terms, retention schedule and data-processing agreements.
- [ ] Confirm the separate University of Juba portal has not been modified.
- [ ] Do not onboard real student data until all critical security tests pass.
