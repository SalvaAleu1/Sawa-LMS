-- Harden tenant privacy and enforce tenant-consistent relationships.
-- This migration intentionally replaces the broad "any tenant member can read every row"
-- policy from 003. Privileged application routes use the server-only service role.
create or replace function public.is_institution_admin(_institution_id uuid)
returns boolean language sql stable security definer set search_path=public
as $$
  select public.is_platform_operator() or exists (
    select 1 from public.institution_memberships im
    join public.institutions i on i.id=im.institution_id
    where im.user_id=auth.uid() and im.institution_id=_institution_id
      and im.role in ('institution_admin','staff') and im.status='active' and i.status='active'
  )
$$;

create or replace function public.is_assigned_lecturer(_institution_id uuid, _course_id uuid)
returns boolean language sql stable security definer set search_path=public
as $$
  select public.is_platform_operator() or exists (
    select 1 from public.courses c
    join public.institution_memberships im on im.id=c.lecturer_membership_id
    join public.institutions i on i.id=c.institution_id
    where c.id=_course_id and c.institution_id=_institution_id
      and im.user_id=auth.uid() and im.institution_id=_institution_id
      and im.role='lecturer' and im.status='active' and i.status='active'
  )
$$;

create or replace function public.is_enrolled_learner(_institution_id uuid, _course_id uuid)
returns boolean language sql stable security definer set search_path=public
as $$
  select exists (
    select 1 from public.course_enrolments ce
    join public.learner_records lr on lr.id=ce.learner_id and lr.institution_id=ce.institution_id
    join public.institution_memberships im on im.institution_id=lr.institution_id and im.user_id=auth.uid()
    join public.institutions i on i.id=lr.institution_id
    where ce.institution_id=_institution_id and ce.course_id=_course_id
      and ce.status='enrolled' and lr.user_id=auth.uid()
      and im.role='learner' and im.status='active' and i.status='active'
  )
$$;

create or replace function public.owns_learner_record(_institution_id uuid, _learner_id uuid)
returns boolean language sql stable security definer set search_path=public
as $$
  select exists (
    select 1 from public.learner_records lr
    join public.institution_memberships im on im.institution_id=lr.institution_id and im.user_id=auth.uid()
    join public.institutions i on i.id=lr.institution_id
    where lr.id=_learner_id and lr.institution_id=_institution_id and lr.user_id=auth.uid()
      and im.role='learner' and im.status='active' and i.status='active'
  )
$$;

-- Remove the overly broad member-wide SELECT policies.
do $$
declare t text;
begin
  foreach t in array array[
    'campuses','academic_years','academic_terms','departments','programmes','classes',
    'learner_records','courses','course_enrolments','learning_materials','assignments',
    'assessments','assessment_submissions','attendance_sessions','attendance_records',
    'result_publications','grades','timetables','announcements','discussion_posts',
    'certificates','alumni_records','storage_usage'
  ] loop
    execute format('drop policy if exists tenant_read on public.%I',t);
    execute format('drop policy if exists tenant_manage on public.%I',t);
  end loop;
end $$;

-- Academic structure and institution administration are private to administrators/staff.
create policy admin_read_campuses on public.campuses for select to authenticated using (public.is_institution_admin(institution_id));
create policy admin_manage_campuses on public.campuses for all to authenticated using (public.is_institution_admin(institution_id)) with check (public.is_institution_admin(institution_id));
create policy admin_read_years on public.academic_years for select to authenticated using (public.is_institution_admin(institution_id));
create policy admin_manage_years on public.academic_years for all to authenticated using (public.is_institution_admin(institution_id)) with check (public.is_institution_admin(institution_id));
create policy admin_read_terms on public.academic_terms for select to authenticated using (public.is_institution_admin(institution_id));
create policy admin_manage_terms on public.academic_terms for all to authenticated using (public.is_institution_admin(institution_id)) with check (public.is_institution_admin(institution_id));
create policy admin_read_departments on public.departments for select to authenticated using (public.is_institution_admin(institution_id));
create policy admin_manage_departments on public.departments for all to authenticated using (public.is_institution_admin(institution_id)) with check (public.is_institution_admin(institution_id));
create policy admin_read_programmes on public.programmes for select to authenticated using (public.is_institution_admin(institution_id));
create policy admin_manage_programmes on public.programmes for all to authenticated using (public.is_institution_admin(institution_id)) with check (public.is_institution_admin(institution_id));
create policy admin_read_classes on public.classes for select to authenticated using (public.is_institution_admin(institution_id));
create policy admin_manage_classes on public.classes for all to authenticated using (public.is_institution_admin(institution_id)) with check (public.is_institution_admin(institution_id));
create policy admin_read_learners on public.learner_records for select to authenticated using (public.is_institution_admin(institution_id) or public.owns_learner_record(institution_id,id));
create policy admin_manage_learners on public.learner_records for all to authenticated using (public.is_institution_admin(institution_id)) with check (public.is_institution_admin(institution_id));

-- Course visibility is limited to administrators/staff, assigned lecturers, and enrolled learners.
create policy course_scoped_read on public.courses for select to authenticated using (
 public.is_institution_admin(institution_id) or public.is_assigned_lecturer(institution_id,id)
 or (published and public.is_enrolled_learner(institution_id,id))
);
create policy course_admin_manage on public.courses for all to authenticated using (public.is_institution_admin(institution_id)) with check (public.is_institution_admin(institution_id));
create policy enrolment_scoped_read on public.course_enrolments for select to authenticated using (
 public.is_institution_admin(institution_id) or public.is_assigned_lecturer(institution_id,course_id)
 or public.owns_learner_record(institution_id,learner_id)
);
create policy enrolment_admin_manage on public.course_enrolments for all to authenticated using (public.is_institution_admin(institution_id)) with check (public.is_institution_admin(institution_id));

create policy material_scoped_read on public.learning_materials for select to authenticated using (
 public.is_institution_admin(institution_id) or public.is_assigned_lecturer(institution_id,course_id)
 or (published and public.is_enrolled_learner(institution_id,course_id))
);
create policy material_admin_manage on public.learning_materials for all to authenticated using (public.is_institution_admin(institution_id)) with check (public.is_institution_admin(institution_id));
create policy assignment_scoped_read on public.assignments for select to authenticated using (
 public.is_institution_admin(institution_id) or public.is_assigned_lecturer(institution_id,course_id)
 or (published and public.is_enrolled_learner(institution_id,course_id))
);
create policy assignment_admin_manage on public.assignments for all to authenticated using (public.is_institution_admin(institution_id)) with check (public.is_institution_admin(institution_id));
create policy assessment_scoped_read on public.assessments for select to authenticated using (
 public.is_institution_admin(institution_id) or public.is_assigned_lecturer(institution_id,course_id)
 or (published and public.is_enrolled_learner(institution_id,course_id))
);
create policy assessment_admin_manage on public.assessments for all to authenticated using (public.is_institution_admin(institution_id)) with check (public.is_institution_admin(institution_id));
-- Answer keys remain inaccessible directly; service routes must omit answer_key for learners.
create policy submission_scoped_read on public.assessment_submissions for select to authenticated using (
 public.is_institution_admin(institution_id) or public.is_assigned_lecturer(institution_id,(
   select a.course_id from public.assessments a where a.id=assessment_id and a.institution_id=assessment_submissions.institution_id
 )) or public.owns_learner_record(institution_id,learner_id)
);
create policy submission_learner_insert on public.assessment_submissions for insert to authenticated with check (
 public.owns_learner_record(institution_id,learner_id) and status in ('in_progress','submitted') and score is null and graded_by is null and graded_at is null
);
create policy submission_admin_manage on public.assessment_submissions for all to authenticated using (public.is_institution_admin(institution_id)) with check (public.is_institution_admin(institution_id));

create policy attendance_session_scoped_read on public.attendance_sessions for select to authenticated using (
 public.is_institution_admin(institution_id) or (course_id is not null and public.is_assigned_lecturer(institution_id,course_id))
 or exists(select 1 from public.attendance_records ar where ar.session_id=attendance_sessions.id and public.owns_learner_record(ar.institution_id,ar.learner_id))
);
create policy attendance_session_admin_manage on public.attendance_sessions for all to authenticated using (public.is_institution_admin(institution_id)) with check (public.is_institution_admin(institution_id));
create policy attendance_record_scoped_read on public.attendance_records for select to authenticated using (
 public.is_institution_admin(institution_id) or public.owns_learner_record(institution_id,learner_id)
 or exists(select 1 from public.attendance_sessions s where s.id=session_id and s.course_id is not null and public.is_assigned_lecturer(institution_id,s.course_id))
);
create policy attendance_record_admin_manage on public.attendance_records for all to authenticated using (public.is_institution_admin(institution_id)) with check (public.is_institution_admin(institution_id));

create policy grade_scoped_read on public.grades for select to authenticated using (
 public.is_institution_admin(institution_id) or public.is_assigned_lecturer(institution_id,course_id)
 or (status='published' and public.owns_learner_record(institution_id,learner_id))
);
create policy grade_admin_manage on public.grades for all to authenticated using (public.is_institution_admin(institution_id)) with check (public.is_institution_admin(institution_id));
create policy result_publication_admin_read on public.result_publications for select to authenticated using (public.is_institution_admin(institution_id));
create policy result_publication_admin_manage on public.result_publications for all to authenticated using (public.is_institution_admin(institution_id)) with check (public.is_institution_admin(institution_id));
create policy timetable_admin_read on public.timetables for select to authenticated using (public.is_institution_admin(institution_id));
create policy timetable_admin_manage on public.timetables for all to authenticated using (public.is_institution_admin(institution_id)) with check (public.is_institution_admin(institution_id));
create policy announcement_member_read on public.announcements for select to authenticated using (
 public.is_institution_admin(institution_id) or (published_at is not null and public.has_institution_role(institution_id))
);
create policy announcement_admin_manage on public.announcements for all to authenticated using (public.is_institution_admin(institution_id)) with check (public.is_institution_admin(institution_id));
create policy discussion_scoped_read on public.discussion_posts for select to authenticated using (
 public.is_institution_admin(institution_id) or public.is_assigned_lecturer(institution_id,course_id)
 or public.is_enrolled_learner(institution_id,course_id)
);
create policy discussion_member_insert on public.discussion_posts for insert to authenticated with check (
 author_id=auth.uid() and (public.is_assigned_lecturer(institution_id,course_id) or public.is_enrolled_learner(institution_id,course_id))
);
create policy discussion_admin_manage on public.discussion_posts for all to authenticated using (public.is_institution_admin(institution_id)) with check (public.is_institution_admin(institution_id));

create policy certificate_admin_read on public.certificates for select to authenticated using (public.is_institution_admin(institution_id) or public.owns_learner_record(institution_id,learner_id));
create policy certificate_admin_manage on public.certificates for all to authenticated using (public.is_institution_admin(institution_id)) with check (public.is_institution_admin(institution_id));
create policy alumni_admin_read on public.alumni_records for select to authenticated using (public.is_institution_admin(institution_id) or public.owns_learner_record(institution_id,learner_id));
create policy alumni_admin_manage on public.alumni_records for all to authenticated using (public.is_institution_admin(institution_id)) with check (public.is_institution_admin(institution_id));
create policy storage_usage_admin_read on public.storage_usage for select to authenticated using (public.is_institution_admin(institution_id));

-- Composite unique keys let foreign keys prove that related rows belong to the same tenant.
do $$
declare t text;
begin
 foreach t in array array[
  'campuses','academic_years','academic_terms','departments','programmes','classes',
  'learner_records','courses','institution_memberships','assessments','attendance_sessions',
  'result_publications','discussion_posts'
 ] loop
   execute format('alter table public.%I add constraint %I unique (institution_id,id)',t,t||'_tenant_id_unique');
 end loop;
end $$;

alter table public.academic_terms add constraint academic_terms_year_same_tenant_fk
 foreign key(institution_id,academic_year_id) references public.academic_years(institution_id,id);
alter table public.departments add constraint departments_campus_same_tenant_fk
 foreign key(institution_id,campus_id) references public.campuses(institution_id,id);
alter table public.programmes add constraint programmes_department_same_tenant_fk
 foreign key(institution_id,department_id) references public.departments(institution_id,id);
alter table public.classes add constraint classes_year_same_tenant_fk
 foreign key(institution_id,academic_year_id) references public.academic_years(institution_id,id);
alter table public.learner_records add constraint learners_campus_same_tenant_fk
 foreign key(institution_id,campus_id) references public.campuses(institution_id,id);
alter table public.learner_records add constraint learners_programme_same_tenant_fk
 foreign key(institution_id,programme_id) references public.programmes(institution_id,id);
alter table public.learner_records add constraint learners_class_same_tenant_fk
 foreign key(institution_id,class_id) references public.classes(institution_id,id);
alter table public.courses add constraint courses_department_same_tenant_fk
 foreign key(institution_id,department_id) references public.departments(institution_id,id);
alter table public.courses add constraint courses_programme_same_tenant_fk
 foreign key(institution_id,programme_id) references public.programmes(institution_id,id);
alter table public.courses add constraint courses_term_same_tenant_fk
 foreign key(institution_id,term_id) references public.academic_terms(institution_id,id);
alter table public.courses add constraint courses_class_same_tenant_fk
 foreign key(institution_id,class_id) references public.classes(institution_id,id);
alter table public.courses add constraint courses_lecturer_same_tenant_fk
 foreign key(institution_id,lecturer_membership_id) references public.institution_memberships(institution_id,id);
alter table public.course_enrolments add constraint enrolments_course_same_tenant_fk
 foreign key(institution_id,course_id) references public.courses(institution_id,id);
alter table public.course_enrolments add constraint enrolments_learner_same_tenant_fk
 foreign key(institution_id,learner_id) references public.learner_records(institution_id,id);
alter table public.learning_materials add constraint materials_course_same_tenant_fk
 foreign key(institution_id,course_id) references public.courses(institution_id,id);
alter table public.assignments add constraint assignments_course_same_tenant_fk
 foreign key(institution_id,course_id) references public.courses(institution_id,id);
alter table public.assessments add constraint assessments_course_same_tenant_fk
 foreign key(institution_id,course_id) references public.courses(institution_id,id);
alter table public.assessments add constraint assessments_term_same_tenant_fk
 foreign key(institution_id,term_id) references public.academic_terms(institution_id,id);
alter table public.assessment_submissions add constraint submissions_assessment_same_tenant_fk
 foreign key(institution_id,assessment_id) references public.assessments(institution_id,id);
alter table public.assessment_submissions add constraint submissions_learner_same_tenant_fk
 foreign key(institution_id,learner_id) references public.learner_records(institution_id,id);
alter table public.attendance_sessions add constraint attendance_sessions_course_same_tenant_fk
 foreign key(institution_id,course_id) references public.courses(institution_id,id);
alter table public.attendance_sessions add constraint attendance_sessions_class_same_tenant_fk
 foreign key(institution_id,class_id) references public.classes(institution_id,id);
alter table public.attendance_records add constraint attendance_records_session_same_tenant_fk
 foreign key(institution_id,session_id) references public.attendance_sessions(institution_id,id);
alter table public.attendance_records add constraint attendance_records_learner_same_tenant_fk
 foreign key(institution_id,learner_id) references public.learner_records(institution_id,id);
alter table public.grades add constraint grades_learner_same_tenant_fk
 foreign key(institution_id,learner_id) references public.learner_records(institution_id,id);
alter table public.grades add constraint grades_course_same_tenant_fk
 foreign key(institution_id,course_id) references public.courses(institution_id,id);
alter table public.grades add constraint grades_term_same_tenant_fk
 foreign key(institution_id,term_id) references public.academic_terms(institution_id,id);
alter table public.grades add constraint grades_assessment_same_tenant_fk
 foreign key(institution_id,assessment_id) references public.assessments(institution_id,id);
alter table public.grades add constraint grades_publication_same_tenant_fk
 foreign key(institution_id,publication_id) references public.result_publications(institution_id,id);
alter table public.timetables add constraint timetables_term_same_tenant_fk
 foreign key(institution_id,term_id) references public.academic_terms(institution_id,id);
alter table public.timetables add constraint timetables_course_same_tenant_fk
 foreign key(institution_id,course_id) references public.courses(institution_id,id);
alter table public.timetables add constraint timetables_class_same_tenant_fk
 foreign key(institution_id,class_id) references public.classes(institution_id,id);
alter table public.discussion_posts add constraint discussions_course_same_tenant_fk
 foreign key(institution_id,course_id) references public.courses(institution_id,id);
alter table public.discussion_posts add constraint discussions_parent_same_tenant_fk
 foreign key(institution_id,parent_id) references public.discussion_posts(institution_id,id);
alter table public.certificates add constraint certificates_learner_same_tenant_fk
 foreign key(institution_id,learner_id) references public.learner_records(institution_id,id);
alter table public.alumni_records add constraint alumni_learner_same_tenant_fk
 foreign key(institution_id,learner_id) references public.learner_records(institution_id,id);

-- These tables are accessed only through trusted server-side jobs/routes.
revoke all on public.background_jobs, public.integration_keys from anon, authenticated;
