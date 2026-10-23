-- Public partner intake is separate from approved institutions.
-- Applications never create an active tenant or grant administrative access.
create type public.partner_application_status as enum ('pending_review','under_review','approved','rejected','withdrawn');

create table public.partner_applications (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null check (length(trim(legal_name)) between 2 and 180),
  display_name text not null check (length(trim(display_name)) between 2 and 120),
  institution_type text not null check (institution_type in ('university','college','school','vocational_centre','training_centre','other')),
  country_code char(2) not null,
  contact_name text not null check (length(trim(contact_name)) between 2 and 120),
  contact_email text not null check (length(contact_email) <= 254),
  contact_phone text not null check (length(trim(contact_phone)) between 5 and 40),
  website text,
  estimated_learners integer not null default 0 check (estimated_learners between 0 and 10000000),
  message text check (message is null or length(message) <= 1500),
  status public.partner_application_status not null default 'pending_review',
  reviewed_by uuid references public.profiles(id) on delete restrict,
  reviewed_at timestamptz,
  review_notes text,
  created_institution_id uuid references public.institutions(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index partner_applications_review_queue_idx on public.partner_applications(status, created_at desc);
create index partner_applications_email_idx on public.partner_applications(lower(contact_email));
create unique index partner_applications_one_pending_contact_idx
  on public.partner_applications(lower(contact_email))
  where status in ('pending_review','under_review');

alter table public.partner_applications enable row level security;
-- No anonymous or ordinary authenticated browser access. The Worker writes using
-- its server-only service-role secret; platform review endpoints must be role-checked.
revoke all on public.partner_applications from anon, authenticated;
grant select, insert, update on public.partner_applications to service_role;

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public
as $$ begin new.updated_at = now(); return new; end $$;

create trigger partner_applications_updated_at
before update on public.partner_applications
for each row execute function public.set_updated_at();
