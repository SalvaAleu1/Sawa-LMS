-- Assignment submission and grading lifecycle. All writes go through the authenticated Worker API.
create table if not exists public.assignment_submissions (
 id uuid primary key default gen_random_uuid(),
 institution_id uuid not null references public.institutions(id) on delete restrict,
 assignment_id uuid not null references public.assignments(id) on delete restrict,
 learner_id uuid not null references public.learner_records(id) on delete restrict,
 submission_text text not null check(length(submission_text)<=30000),
 status text not null default 'submitted' check(status in ('submitted','graded','returned')),
 submitted_at timestamptz not null default now(),
 score numeric(10,2),
 feedback text,
 graded_by uuid references public.profiles(id) on delete restrict,
 graded_at timestamptz,
 created_at timestamptz not null default now(),
 unique(assignment_id,learner_id),
 check(score is null or score>=0)
);
create index if not exists assignment_submissions_tenant_assignment_idx
 on public.assignment_submissions(institution_id,assignment_id,status);
alter table public.assignment_submissions enable row level security;
revoke all on public.assignment_submissions from public, anon, authenticated;
grant all on public.assignment_submissions to service_role;
