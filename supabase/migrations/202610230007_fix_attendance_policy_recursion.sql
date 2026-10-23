-- Avoid a circular RLS dependency between attendance_sessions and attendance_records.
drop policy if exists attendance_session_scoped_read on public.attendance_sessions;
create policy attendance_session_scoped_read on public.attendance_sessions
for select to authenticated using (
  public.is_institution_admin(institution_id)
  or (course_id is not null and (
    public.is_assigned_lecturer(institution_id,course_id)
    or public.is_enrolled_learner(institution_id,course_id)
  ))
);
