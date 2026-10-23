-- Two-tenant smoke test: learner A cannot read learner B's record and cannot
-- create a cross-tenant enrolment even if the client submits another tenant's IDs.
insert into auth.users(id,email) values
 ('10000000-0000-4000-8000-000000000001','learner-a@example.test'),
 ('20000000-0000-4000-8000-000000000002','learner-b@example.test');
insert into public.profiles(id,display_name,email) values
 ('10000000-0000-4000-8000-000000000001','Learner A','learner-a@example.test'),
 ('20000000-0000-4000-8000-000000000002','Learner B','learner-b@example.test');
insert into public.institutions(id,slug,legal_name,display_name,institution_type,country_code,status) values
 ('10000000-0000-4000-8000-000000000010','tenant-a','Tenant A','Tenant A','college','SS','active'),
 ('20000000-0000-4000-8000-000000000020','tenant-b','Tenant B','Tenant B','college','SS','active');
insert into public.institution_memberships(institution_id,user_id,role,status) values
 ('10000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000001','learner','active'),
 ('20000000-0000-4000-8000-000000000020','20000000-0000-4000-8000-000000000002','learner','active');
insert into public.learner_records(id,institution_id,user_id,learner_number,first_name,last_name) values
 ('10000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000001','A-001','Learner','A'),
 ('20000000-0000-4000-8000-000000000021','20000000-0000-4000-8000-000000000020','20000000-0000-4000-8000-000000000002','B-001','Learner','B');
insert into public.courses(id,institution_id,code,title) values
 ('10000000-0000-4000-8000-000000000012','10000000-0000-4000-8000-000000000010','A-COURSE','Tenant A course'),
 ('20000000-0000-4000-8000-000000000022','20000000-0000-4000-8000-000000000020','B-COURSE','Tenant B course');

set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
do $$
declare visible_count integer; foreign_count integer;
begin
  select count(*) into visible_count from public.learner_records;
  if visible_count <> 1 then raise exception 'tenant privacy test failed: expected 1 learner record, saw %',visible_count; end if;
  select count(*) into foreign_count from public.learner_records where learner_number='B-001';
  if foreign_count <> 0 then raise exception 'tenant privacy test failed: another learner record was visible'; end if;
end $$;
reset role;

do $$
begin
  begin
    insert into public.course_enrolments(institution_id,course_id,learner_id)
    values('10000000-0000-4000-8000-000000000010','20000000-0000-4000-8000-000000000022','10000000-0000-4000-8000-000000000011');
    raise exception 'cross-tenant enrolment unexpectedly succeeded';
  exception when foreign_key_violation then
    null;
  end;
end $$;
