# SawaLearn
**One platform. Every learning journey.**

SawaLearn is a multi-tenant learning and institution-management platform for universities, colleges, schools and vocational training centres. It is independent of the University of Juba portal.

## Included workflows
- Institution application intake, platform review and controlled first-administrator invitations.
- Institution sign-in and tenant-scoped workspace.
- Learner records, staff/member invitations and activation, courses, enrolments, learning materials, assignments, assessment question authoring, learner submissions, objective auto-grading and manual grading, assignment text submissions and lecturer grading, attendance sessions and records, grades, staged result approval/publication, announcements and timetable records.
- Published-grade transcript calculations (term GPA and cumulative GPA) and one-time-token certificate issuance with public verification.
- Private Cloudflare R2 uploads with file-type/size validation, institution membership checks and plan storage-quota checks.
- Subscription review, manually recorded and confirmed cash receipts, platform-owner extension/termination actions, seven-day renewal reminders and grace-period overdue alerts.
- Idempotent email notification queue with retries and capacity warnings at 80%, 90% and 100%.
- PostgreSQL migration validation and tenant-isolation smoke tests in GitHub Actions.

## Architecture
- React + TypeScript + Vite frontend.
- Cloudflare Worker API (Hono).
- Supabase PostgreSQL/Auth with row-level security and tenant-consistent foreign keys.
- Private Cloudflare R2 bucket for learning files.
- Resend for transactional email delivery.
- GitHub Actions for type checks, frontend build, tests and isolated PostgreSQL migration validation.

## Local verification
Requirements: Node.js 20+, pnpm 9+, and PostgreSQL 16 for the database integration tests.

```sh
pnpm install
cp .env.example .env.local
pnpm typecheck
pnpm typecheck:api
pnpm test
pnpm build
pnpm dev
```

For Worker development: `pnpm --filter @sawalearn/api dev`.

## Environment and Cloudflare configuration
Frontend build variables:
- `VITE_SUPABASE_URL`: Supabase project URL.
- `VITE_SUPABASE_ANON_KEY`: public anonymous key only.
- `VITE_API_BASE_URL`: deployed SawaLearn Worker base URL, without a trailing slash.

Worker secrets (never expose in frontend variables or source control):
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY`
- `RESEND_FROM`

Set `APP_BASE_URL` as a Worker variable to the exact frontend origin for CORS and invitation redirects. The Worker configuration binds the private R2 bucket `sawalearn-files` and schedules daily maintenance at 02:17 UTC. Create the bucket before deploying the Worker. For the frontend, use Cloudflare Pages with the repository root as the project root, build command `pnpm build`, and output directory `dist`. The `public/_redirects` file keeps direct SPA routes working on refresh. Deploy the Worker separately from `services/api` using Wrangler.

## Database rollout
Apply migrations in filename order from `supabase/migrations` to the intended Supabase project after reviewing them. GitHub Actions applies them to an isolated PostgreSQL instance and executes a two-tenant RLS/foreign-key smoke test; this does not apply migrations to your production project.

## Security and operating rules
- Never trust tenant IDs, roles, plan limits or payment status supplied by the browser.
- Keep the service-role key exclusively in Worker secrets.
- First institutional administrators require platform-owner approval and one-time invitations.
- Members must verify their invitation email before an administrator activates their access.
- Cash payments remain pending until an authorized operator confirms the receipt.
- Subscription expiry never deletes data and never triggers automatic termination. After the seven-day grace period, the subscription is marked overdue and requires a platform-owner decision.
- Capacity limits prevent new activations and uploads beyond allowance; existing access and academic history are preserved.
- Archived users and historical academic records are retained.
- Do not onboard real student records until the full CI suite passes and the production checklist is complete.

## Release
See [docs/RELEASE-CHECKLIST.md](docs/RELEASE-CHECKLIST.md). Production service availability, real Supabase Auth email delivery, R2 bucket configuration, and live-provider behavior must be verified after the repository is deployed and credentials are configured.
