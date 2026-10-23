# SawaLearn release checklist

## Repository verification
- [ ] GitHub Actions passes type checking, Worker type checking, frontend build and unit tests.
- [ ] GitHub Actions successfully applies every SQL migration to isolated PostgreSQL and passes tenant isolation tests.
- [ ] Review the migration set and confirm it matches the intended Supabase project before applying it.

## Cloudflare and Supabase setup
- [ ] Create a private R2 bucket named `sawalearn-files` in the Cloudflare account.
- [ ] Deploy the Worker from `services/api`; confirm the R2 binding and daily cron trigger are present.
- [ ] Configure Worker variables `APP_ENV` and `APP_BASE_URL`.
- [ ] Configure Worker secrets `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, and `RESEND_FROM`.
- [ ] Configure frontend build variables `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_API_BASE_URL`.
- [ ] Set Supabase Auth site URL/redirect allowlist and configure invitation email delivery.
- [ ] Apply reviewed migrations in filename order and verify no migration failed.
- [ ] Confirm the frontend bundle contains only the Supabase anonymous key and no service-role key.

## Operational tests
- [ ] Create platform owner membership securely; do not add an open public owner-signup route.
- [ ] Submit an institution application, review it, approve it and redeem the one-time first-admin invitation.
- [ ] Test invite email verification, member activation, user-cap enforcement and archive/history retention.
- [ ] Test courses, enrolments, materials, assignments, assessments, attendance, grades, result publication and timetable records with distinct roles.
- [ ] Test cross-tenant access denial with real authenticated JWTs in the deployed environment.
- [ ] Test private R2 upload/download, MIME/size limits, plan quota enforcement and learner course-enrolment checks.
- [ ] Record a cash receipt without confirmation, verify it remains pending, then confirm it as an authorized operator.
- [ ] Verify seven-day reminders, retry/idempotency behavior, overdue owner-decision alerts and manual extension/termination.
- [ ] Verify 80%, 90% and 100% user/storage warnings and that existing access remains available at capacity.
- [ ] Configure backups, rehearse restore and tenant-specific export, and set error/uptime monitoring.
- [ ] Verify accessibility, mobile layout, low-bandwidth use, privacy notice, retention schedule and incident contacts.
- [ ] Confirm the separate University of Juba portal has not been modified.

Do not onboard real student data until all repository checks and the critical deployed-service tests pass.
