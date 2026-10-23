-- SawaLearn academic operations and advanced feature schema.
-- Tenant ownership is explicit on every institution-scoped row. Apply after 001 and 002.
create extension if not exists pgcrypto;

create table public.campuses (
 id uuid primary key default gen_random_uuid(), institution_id uuid not null references public.institutions(id) on delete restrict,
 name text not null, code text, address text, is_active boolean not null default true, created_at timestamptz not null default now(),
 unique(institution_id,code)
);
create table public.academic_years (
 id uuid primary key default gen_random_uuid(), institution_id uuid not null references public.institutions(id) on delete restrict,
 name text not null, starts_on date not null, ends_on date not null, is_current boolean not null default false,
 created_at timestamptz not null default now(), check(ends_on>=starts_on), unique(institution_id,name)
);
create table public.academic_terms (
 id uuid primary key default gen_random_uuid(), institution_id uuid not null references public.institutions(id) on delete restrict,
 academic_year_id uuid not null references public.academic_years(id) on delete restrict,
 name text not null, starts_on date not null, ends_on date not null, created_at timestamptz not null default now(),
 check(ends_on>=starts_on), unique(academic_year_id,name)
);
create table public.departments (
 id uuid primary key default gen_random_uuid(), institution_id uuid not null references public.institutions(id) on delete restrict,
 campus_id uuid references public.campuses(id) on delete restrict, name text not null, code text,
 created_at timestamptz not null default now(), unique(institution_id,code)
);
create table public.programmes (
 id uuid primary key default gen_random_uuid(), institution_id uuid not null references public.institutions(id) on delete restrict,
 department_id uuid references public.departments(id) on delete restrict, name text not null, code text,
 level text, duration_terms integer, credit_hours numeric(8,2), grading_scheme jsonb not null default '{"type":"percentage"}',
 created_at timestamptz not null default now(), unique(institution_id,code)
);
create table public.classes (
 id uuid primary key default gen_random_uuid(), institution_id uuid not null references public.institutions(id) on delete restrict,
 academic_year_id uuid references public.academic_years(id) on delete restrict, name text not null, stream text,
 level text, created_at timestamptz not null default now(), unique(institution_id,academic_year_id,name,stream)
);
create table public.learner_records (
 id uuid primary key default gen_random_uuid(), institution_id uuid not null references public.institutions(id) on delete restrict,
 user_id uuid references public.profiles(id) on delete restrict, campus_id uuid references public.campuses(id) on delete restrict,
 programme_id uuid references public.programmes(id) on delete restrict, class_id uuid references public.classes(id) on delete restrict,
 learner_number text not null, first_name text not null, last_name text not null, date_of_birth date,
 admission_date date, status public.account_status not null default 'active', metadata jsonb not null default '{}',
 created_at timestamptz not null default now(), unique(institution_id,learner_number)
);
create index learner_records_tenant_status_idx on public.learner_records(institution_id,status);
create table public.courses (
 id uuid primary key default gen_random_uuid(), institution_id uuid not null references public.institutions(id) on delete restrict,
 department_id uuid references public.departments(id) on delete restrict, programme_id uuid references public.programmes(id) on delete restrict,
 term_id uuid references public.academic_terms(id) on delete restrict, class_id uuid references public.classes(id) on delete restrict,
 code text not null, title text not null, description text, credits numeric(8,2) not null default 0,
 lecturer_membership_id uuid references public.institution_memberships(id) on delete restrict,
 published boolean not null default false, created_at timestamptz not null default now(), unique(institution_id,code)
);
create table public.course_enrolments (
 id uuid primary key default gen_random_uuid(), institution_id uuid not null references public.institutions(id) on delete restrict,
 course_id uuid not null references public.courses(id) on delete restrict, learner_id uuid not null references public.learner_records(id) on delete restrict,
 status text not null default 'enrolled' check(status in ('enrolled','withdrawn','completed','incomplete')),
 enrolled_at timestamptz not null default now(), unique(course_id,learner_id)
);
create table public.learning_materials (
 id uuid primary key default gen_random_uuid(), institution_id uuid not null references public.institutions(id) on delete restrict,
 course_id uuid not null references public.courses(id) on delete restrict, title text not null, description text,
 object_key text not null, content_type text, size_bytes bigint not null default 0 check(size_bytes>=0),
 uploaded_by uuid references public.profiles(id) on delete restrict, published boolean not null default false,
 created_at timestamptz not null default now(), unique(institution_id,object_key)
);
create table public.assignments (
 id uuid primary key default gen_random_uuid(), institution_id uuid not null references public.institutions(id) on delete restrict,
 course_id uuid not null references public.courses(id) on delete restrict, title text not null, instructions text,
 due_at timestamptz, max_score numeric(10,2) not null default 100 check(max_score>0), published boolean not null default false,
 created_by uuid references public.profiles(id) on delete restrict, created_at timestamptz not null default now()
);
create table public.assessments (
 id uuid primary key default gen_random_uuid(), institution_id uuid not null references public.institutions(id) on delete restrict,
 course_id uuid not null references public.courses(id) on delete restrict, term_id uuid references public.academic_terms(id) on delete restrict,
 title text not null, assessment_type text not null check(assessment_type in ('quiz','exam','test','practical','competency','other')),
 starts_at timestamptz, ends_at timestamptz, max_score numeric(10,2) not null default 100 check(max_score>0),
 settings jsonb not null default '{}', published boolean not null default false, created_at timestamptz not null default now(),
 check(ends_at is null or starts_at is null or ends_at>=starts_at)
);
create table public.assessment_questions (
 id uuid primary key default gen_random_uuid(), institution_id uuid not null references public.institutions(id) on delete restrict,
 assessment_id uuid not null references public.assessments(id) on delete restrict, position integer not null,
 question_type text not null check(question_type in ('single_choice','multiple_choice','short_answer','essay','numeric')),
 prompt text not null, options jsonb not null default '[]', answer_key jsonb, points numeric(10,2) not null default 1 check(points>0),
 created_at timestamptz not null default now(), unique(assessment_id,position)
);
create table public.assessment_submissions (
 id uuid primary key default gen_random_uuid(), institution_id uuid not null references public.institutions(id) on delete restrict,
 assessment_id uuid not null references public.assessments(id) on delete restrict, learner_id uuid not null references public.learner_records(id) on delete restrict,
 answers jsonb not null default '{}', score numeric(10,2), status text not null default 'submitted' check(status in ('in_progress','submitted','graded','returned')),
 submitted_at timestamptz, graded_by uuid references public.profiles(id) on delete restrict, graded_at timestamptz,
 feedback text, unique(assessment_id,learner_id)
);
create table public.attendance_sessions (
 id uuid primary key default gen_random_uuid(), institution_id uuid not null references public.institutions(id) on delete restrict,
 course_id uuid references public.courses(id) on delete restrict, class_id uuid references public.classes(id) on delete restrict,
 held_at timestamptz not null, title text, recorded_by uuid references public.profiles(id) on delete restrict, created_at timestamptz not null default now()
);
create table public.attendance_records (
 id uuid primary key default gen_random_uuid(), institution_id uuid not null references public.institutions(id) on delete restrict,
 session_id uuid not null references public.attendance_sessions(id) on delete restrict, learner_id uuid not null references public.learner_records(id) on delete restrict,
 status text not null check(status in ('present','absent','late','excused')), note text, created_at timestamptz not null default now(),
 unique(session_id,learner_id)
);
create table public.result_publications (
 id uuid primary key default gen_random_uuid(), institution_id uuid not null references public.institutions(id) on delete restrict,
 term_id uuid not null references public.academic_terms(id) on delete restrict, title text not null,
 status text not null default 'draft' check(status in ('draft','submitted_for_approval','approved','published')),
 submitted_by uuid references public.profiles(id) on delete restrict, approved_by uuid references public.profiles(id) on delete restrict,
 approved_at timestamptz, published_at timestamptz, created_at timestamptz not null default now()
);
create table public.grades (
 id uuid primary key default gen_random_uuid(), institution_id uuid not null references public.institutions(id) on delete restrict,
 learner_id uuid not null references public.learner_records(id) on delete restrict, course_id uuid not null references public.courses(id) on delete restrict,
 term_id uuid references public.academic_terms(id) on delete restrict, assessment_id uuid references public.assessments(id) on delete restrict,
 publication_id uuid references public.result_publications(id) on delete restrict, score numeric(10,2), letter_grade text,
 grade_points numeric(8,3), credits numeric(8,2), status text not null default 'draft' check(status in ('draft','submitted','approved','published')),
 entered_by uuid references public.profiles(id) on delete restrict, approved_by uuid references public.profiles(id) on delete restrict,
 created_at timestamptz not null default now()
);
create table public.timetables (
 id uuid primary key default gen_random_uuid(), institution_id uuid not null references public.institutions(id) on delete restrict,
 term_id uuid references public.academic_terms(id) on delete restrict, course_id uuid references public.courses(id) on delete restrict,
 class_id uuid references public.classes(id) on delete restrict, title text not null, starts_at timestamptz not null,
 ends_at timestamptz not null, room text, recurrence jsonb not null default '{}', created_at timestamptz not null default now(),
 check(ends_at>starts_at)
);
create table public.announcements (
 id uuid primary key default gen_random_uuid(), institution_id uuid not null references public.institutions(id) on delete restrict,
 title text not null, body text not null, audience jsonb not null default '{"type":"all"}', published_at timestamptz,
 created_by uuid references public.profiles(id) on delete restrict, created_at timestamptz not null default now()
);
create table public.discussion_posts (
 id uuid primary key default gen_random_uuid(), institution_id uuid not null references public.institutions(id) on delete restrict,
 course_id uuid not null references public.courses(id) on delete restrict, author_id uuid references public.profiles(id) on delete restrict,
 parent_id uuid references public.discussion_posts(id) on delete restrict, body text not null check(length(body)<=10000),
 moderated_at timestamptz, created_at timestamptz not null default now()
);
create table public.certificates (
 id uuid primary key default gen_random_uuid(), institution_id uuid not null references public.institutions(id) on delete restrict,
 learner_id uuid not null references public.learner_records(id) on delete restrict, certificate_number text not null,
 certificate_type text not null, issued_at timestamptz not null default now(), issued_by uuid references public.profiles(id) on delete restrict,
 revoked_at timestamptz, verification_token_hash text not null unique, metadata jsonb not null default '{}',
 unique(institution_id,certificate_number)
);
create table public.alumni_records (
 id uuid primary key default gen_random_uuid(), institution_id uuid not null references public.institutions(id) on delete restrict,
 learner_id uuid not null references public.learner_records(id) on delete restrict, graduated_at date,
 qualification text, contact_opt_in boolean not null default false, metadata jsonb not null default '{}',
 created_at timestamptz not null default now(), unique(institution_id,learner_id)
);
create table public.notifications (
 id uuid primary key default gen_random_uuid(), institution_id uuid references public.institutions(id) on delete restrict,
 recipient_user_id uuid references public.profiles(id) on delete restrict, channel text not null check(channel in ('in_app','email')),
 template_key text not null, payload jsonb not null default '{}', scheduled_at timestamptz not null default now(),
 sent_at timestamptz, status text not null default 'queued' check(status in ('queued','sending','sent','failed','cancelled')),
 attempts integer not null default 0, idempotency_key text not null unique, last_error text, created_at timestamptz not null default now()
);
create table public.background_jobs (
 id uuid primary key default gen_random_uuid(), job_type text not null, payload jsonb not null default '{}',
 run_at timestamptz not null default now(), status text not null default 'queued' check(status in ('queued','running','succeeded','failed')),
 attempts integer not null default 0, idempotency_key text not null unique, last_error text, created_at timestamptz not null default now()
);
create table public.storage_usage (
 institution_id uuid primary key references public.institutions(id) on delete restrict,
 used_bytes bigint not null default 0 check(used_bytes>=0), updated_at timestamptz not null default now()
);
create table public.integration_keys (
 id uuid primary key default gen_random_uuid(), institution_id uuid not null references public.institutions(id) on delete restrict,
 key_hash text not null unique, label text not null, scopes text[] not null default '{}',
 last_used_at timestamptz, revoked_at timestamptz, created_by uuid references public.profiles(id) on delete restrict,
 created_at timestamptz not null default now()
);

-- Tenant policies: users must have an active membership in an active institution.
do $$
declare t text;
begin
 foreach t in array array['campuses','academic_years','academic_terms','departments','programmes','classes','learner_records','courses','course_enrolments','learning_materials','assignments','assessments','assessment_questions','assessment_submissions','attendance_sessions','attendance_records','result_publications','grades','timetables','announcements','discussion_posts','certificates','alumni_records','storage_usage','integration_keys'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy tenant_read on public.%I for select to authenticated using (public.has_institution_role(institution_id))',t);
  execute format('create policy tenant_manage on public.%I for all to authenticated using (public.has_institution_role(institution_id,array[''institution_admin'']::public.platform_role[])) with check (public.has_institution_role(institution_id,array[''institution_admin'']::public.platform_role[]))',t);
 end loop;
end $$;
alter table public.notifications enable row level security;
create policy notification_recipient_read on public.notifications for select to authenticated using (recipient_user_id=auth.uid() or (institution_id is not null and public.has_institution_role(institution_id,array['institution_admin']::public.platform_role[])));
alter table public.background_jobs enable row level security;
revoke all on public.background_jobs from anon, authenticated;
revoke all on public.integration_keys from anon, authenticated;
revoke all on public.assessment_questions from anon, authenticated;
-- Assessment answer keys are never exposed to learners; serve questions through a server route
-- that omits answer_key. Direct access to this table is denied to browser roles.
revoke all on public.assessment_questions from anon, authenticated;
