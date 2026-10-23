# SawaLearn
**One platform. Every learning journey.**

SawaLearn is a multi-tenant learning management and institution-management platform for universities, colleges, schools and vocational training centres. This repository is independent of the University of Juba portal.

## Seven-stage delivery plan
1. **Foundation** — brand, app shell, environment configuration, database baseline, CI and security conventions.
2. **Platform administration** — platform-owner controls, institution approval, secure first-admin invitations, plan and payment review.
3. **Institution management** — tenant isolation, institution workspace, configurable academic structures, staff and learner lifecycle.
4. **Learning and academic operations** — courses, learning materials, assessments, attendance, grading, examinations and results approvals.
5. **Automation** — subscription notices, 7-day grace period, capacity warnings, retries, idempotency and audit trail.
6. **Advanced features** — transcripts and QR verification, alumni, reporting, PWA/low-bandwidth support and optional integrations.
7. **Production verification** — automated tests, tenant-isolation checks, accessibility, deployment, backups, monitoring and release checklist.

## Current implementation status
This branch establishes the initial application foundation and database baseline. It is **not yet a production-ready LMS**; the remaining stages must be implemented and verified before real institutional data is onboarded.

## Architecture
- React + TypeScript + Vite frontend.
- Cloudflare Worker API (Hono) for server-side request handling.
- Supabase PostgreSQL/Auth; Row Level Security and tenant-scoped policies.
- Cloudflare R2 for object storage (signed access via server-side authorization).
- Resend-compatible transactional email adapter.
- GitHub Actions for type/build checks.

## Local development
1. Install Node.js 20+ and pnpm 9+.
2. Run `pnpm install`.
3. Copy `.env.example` to `.env.local` and set the public Supabase URL/key for the frontend. Never expose service-role keys.
4. Run `pnpm dev`.
5. Worker development: `pnpm --filter @sawalearn/api dev`.

## Security rules
- Never trust tenant IDs, roles, plan limits or payment status supplied by the browser.
- Enforce authorization on the server and in PostgreSQL RLS.
- First institutional administrator accounts require platform-owner approval and a one-time invite.
- Cash payments are recorded and confirmed manually; never infer receipt.
- Expiry never deletes data or automatically terminates an institution. Keep service available with overdue state until the platform owner acts.
- At capacity, block only new activations or uploads that exceed limits; existing users and materials remain accessible.
- Archive/deactivate people instead of deleting academic history.
- Do not store passwords, payment PINs, secrets or service-role keys in source control.

## Deployment
Configure Cloudflare Worker secrets with Wrangler and apply reviewed SQL migrations to the correct Supabase project. Run CI and the production checklist before release. See `docs/RELEASE-CHECKLIST.md`.
