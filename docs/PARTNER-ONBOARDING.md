# Partner onboarding deployment notes

## Current partner application flow

The public form is available at `/partners/apply`. It records a **pending application**, not an approved institution. It does not create a tenant, subscription, or administrator account.

## Required Supabase setup

1. Review the migrations in timestamp order.
2. Apply `202610230001_initial_tenant_foundation.sql`.
3. Apply `202610230002_partner_application_intake.sql`.
4. Verify that the `partner_applications` table exists and RLS is enabled.

Do not expose the Supabase service-role key in a `VITE_*` variable or frontend code.

## Cloudflare Worker variables and secrets

Set Worker variables:
- `APP_ENV=production`
- `APP_BASE_URL=https://YOUR-FRONTEND-DOMAIN` (origin only, no path or trailing slash)

Set Worker secrets:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Frontend build variable

Set `VITE_API_BASE_URL=https://YOUR-WORKER-API-DOMAIN` as a build-time environment variable for the frontend.

## Verification before accepting real partner data

- Test a valid application and confirm one pending row is stored.
- Test invalid email, invalid country code and missing required fields.
- Test duplicate pending contact submission.
- Confirm browser network responses never contain database credentials.
- Confirm unauthenticated users cannot query `partner_applications` from Supabase directly.
- Confirm the Worker health endpoint returns `/health`.
- Confirm CORS permits only the configured frontend origin.

## Important launch limitation

This delivery adds secure server-side partner intake. The authenticated platform-owner review queue, approval-to-institution workflow, first-administrator invitation, and email notifications must be completed and tested before the platform can be considered ready for full partner onboarding. Do not promise an application will be reviewed from the dashboard until those controls are deployed.

## Platform review access

The restricted review screen is `/platform/review`. It uses Supabase Auth and the Worker verifies the user's token and platform membership on every queue/action request. To bootstrap the first operator, create the operator's Auth user in Supabase, then create their profile and `platform_memberships` row through a trusted SQL session. Never expose service-role credentials in the browser.

Example SQL (replace the UUID with the verified Auth user ID; run only from the Supabase SQL editor as project owner):
```sql
insert into public.profiles (id, display_name, email)
values ('AUTH-USER-UUID', 'Platform Owner', 'owner@example.org')
on conflict (id) do nothing;

insert into public.platform_memberships (user_id, role)
values ('AUTH-USER-UUID', 'platform_owner')
on conflict do nothing;
```

The review screen can mark submissions as under review or rejected and records an audit event. **It does not yet approve/create institutions or issue first-administrator invitations.** Keep this in pre-launch testing until secure provisioning and invitation redemption are implemented.
