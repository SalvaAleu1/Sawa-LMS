-- SawaLearn multi-tenant foundation.
-- Apply only after reviewing against the intended Supabase project.
create extension if not exists pgcrypto;

create type public.institution_status as enum ('pending_review','active','suspended','terminated');
create type public.subscription_status as enum ('pending_payment','active','grace_period','overdue','terminated');
create type public.account_status as enum ('invited','active','inactive','archived');
create type public.platform_role as enum ('platform_owner','platform_admin','institution_admin','lecturer','staff','learner');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null,
  email text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.institutions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  legal_name text not null,
  display_name text not null,
  institution_type text not null check (institution_type in ('university','college','school','vocational_centre','training_centre','other')),
  country_code char(2) not null default 'SS',
  timezone text not null default 'Africa/Juba',
  status public.institution_status not null default 'pending_review',
  branding jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  approved_by uuid references public.profiles(id) on delete restrict,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.platform_memberships (
  user_id uuid not null references public.profiles(id) on delete restrict,
  role public.platform_role not null check (role in ('platform_owner','platform_admin')),
  created_at timestamptz not null default now(),
  primary key(user_id, role)
);

create table public.institution_memberships (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  role public.platform_role not null check (role in ('institution_admin','lecturer','staff','learner')),
  status public.account_status not null default 'invited',
  external_id text,
  activated_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique(institution_id,user_id),
  unique(institution_id,external_id)
);
create index institution_memberships_user_idx on public.institution_memberships(user_id);
create index institution_memberships_tenant_role_idx on public.institution_memberships(institution_id,role,status);

create table public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  monthly_price numeric(12,2) not null check(monthly_price >= 0),
  annual_price numeric(12,2) not null check(annual_price >= 0),
  currency char(3) not null default 'USD',
  max_active_users integer not null check(max_active_users > 0),
  storage_limit_bytes bigint not null check(storage_limit_bytes > 0),
  campus_limit integer not null default 1 check(campus_limit > 0),
  feature_entitlements jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.institution_subscriptions (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete restrict,
  plan_id uuid not null references public.subscription_plans(id) on delete restrict,
  status public.subscription_status not null default 'pending_payment',
  billing_period text not null check(billing_period in ('monthly','annual')),
  period_start date not null,
  period_end date not null,
  grace_end date not null,
  owner_decision_required boolean not null default false,
  extended_until date,
  terminated_at timestamptz,
  terminated_by uuid references public.profiles(id) on delete restrict,
  created_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(period_end >= period_start),
  check(grace_end >= period_end)
);
create index institution_subscriptions_due_idx on public.institution_subscriptions(status,period_end,grace_end);

create table public.cash_receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_number bigint generated always as identity unique,
  institution_id uuid not null references public.institutions(id) on delete restrict,
  subscription_id uuid not null references public.institution_subscriptions(id) on delete restrict,
  amount numeric(12,2) not null check(amount > 0),
  currency char(3) not null,
  received_on date not null,
  billing_period text not null check(billing_period in ('monthly','annual')),
  covered_from date not null,
  covered_until date not null,
  exchange_rate numeric(18,8),
  payment_reference text,
  notes text,
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  check(covered_until >= covered_from)
);

create table public.first_admin_invites (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete restrict,
  email text not null,
  token_hash text not null unique,
  approved_by uuid not null references public.profiles(id) on delete restrict,
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check(expires_at > created_at)
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid references public.profiles(id) on delete restrict,
  institution_id uuid references public.institutions(id) on delete restrict,
  action text not null,
  target_type text not null,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  request_id text,
  created_at timestamptz not null default now()
);
create index audit_logs_tenant_time_idx on public.audit_logs(institution_id,created_at desc);
create index audit_logs_actor_time_idx on public.audit_logs(actor_user_id,created_at desc);

-- Authorization helpers use auth.uid() and the caller's own memberships.
create or replace function public.is_platform_operator()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.platform_memberships pm where pm.user_id = auth.uid() and pm.role in ('platform_owner','platform_admin')) $$;

create or replace function public.has_institution_role(_institution_id uuid, _roles public.platform_role[] default null)
returns boolean language sql stable security definer set search_path = public
as $$ select public.is_platform_operator() or exists(
  select 1 from public.institution_memberships im
  join public.institutions i on i.id=im.institution_id
  where im.user_id=auth.uid() and im.institution_id=_institution_id
    and im.status='active' and i.status='active'
    and (_roles is null or im.role=any(_roles))
) $$;

alter table public.profiles enable row level security;
alter table public.institutions enable row level security;
alter table public.platform_memberships enable row level security;
alter table public.institution_memberships enable row level security;
alter table public.subscription_plans enable row level security;
alter table public.institution_subscriptions enable row level security;
alter table public.cash_receipts enable row level security;
alter table public.first_admin_invites enable row level security;
alter table public.audit_logs enable row level security;

create policy "profile self or platform operator" on public.profiles for select using (id=auth.uid() or public.is_platform_operator());
create policy "profile self update" on public.profiles for update using (id=auth.uid()) with check (id=auth.uid());
create policy "platform memberships visible to self or operators" on public.platform_memberships for select using (user_id=auth.uid() or public.is_platform_operator());
create policy "institutions visible to approved members" on public.institutions for select using (public.is_platform_operator() or exists(select 1 from public.institution_memberships im where im.institution_id=id and im.user_id=auth.uid() and im.status='active'));
create policy "institution members see own tenant" on public.institution_memberships for select using (user_id=auth.uid() or public.has_institution_role(institution_id,array['institution_admin']::public.platform_role[]));
create policy "plans visible to authenticated users" on public.subscription_plans for select to authenticated using (is_active or public.is_platform_operator());
create policy "subscription visible to tenant admins" on public.institution_subscriptions for select using (public.has_institution_role(institution_id,array['institution_admin']::public.platform_role[]));
create policy "receipts visible to tenant admins" on public.cash_receipts for select using (public.has_institution_role(institution_id,array['institution_admin']::public.platform_role[]));
create policy "first admin invites only operators" on public.first_admin_invites for select using (public.is_platform_operator());
create policy "audit visible to operators or tenant admins" on public.audit_logs for select using (public.is_platform_operator() or (institution_id is not null and public.has_institution_role(institution_id,array['institution_admin']::public.platform_role[])));

-- Writes to approvals, memberships, subscriptions, receipts, invites and audit records
-- are intentionally not granted by browser policies. Add narrowly scoped RPCs/server
-- handlers with explicit role checks and audit insertion in the next implementation stage.
revoke all on public.platform_memberships, public.first_admin_invites from anon, authenticated;
revoke insert, update, delete on public.institutions, public.institution_memberships, public.institution_subscriptions, public.cash_receipts, public.audit_logs from anon, authenticated;
