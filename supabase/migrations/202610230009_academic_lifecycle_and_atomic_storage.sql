-- Production hardening: atomic storage reservations and academic lifecycle safeguards.
create or replace function public.adjust_storage_usage(
  p_institution_id uuid,
  p_delta bigint,
  p_limit bigint
) returns bigint
language plpgsql
security definer
set search_path=public
as $$
declare v_used bigint;
begin
  if p_delta = 0 or p_limit < 0 then
    raise exception 'invalid storage adjustment' using errcode='22023';
  end if;
  insert into public.storage_usage(institution_id, used_bytes, updated_at)
  values (p_institution_id, 0, now())
  on conflict (institution_id) do nothing;
  update public.storage_usage
     set used_bytes = used_bytes + p_delta, updated_at = now()
   where institution_id = p_institution_id
     and used_bytes + p_delta >= 0
     and (p_delta < 0 or used_bytes + p_delta <= p_limit)
  returning used_bytes into v_used;
  if v_used is null then return null; end if;
  return v_used;
end;
$$;
revoke all on function public.adjust_storage_usage(uuid,bigint,bigint) from public, anon, authenticated;
grant execute on function public.adjust_storage_usage(uuid,bigint,bigint) to service_role;

-- Published assessments must not expose keys through the browser; all question reads go through the API.
revoke all on public.assessment_submissions from anon, authenticated;
grant select on public.assessment_submissions to authenticated;
-- RLS still governs permitted rows; direct write privileges are removed so submission/grading must use API.
revoke insert, update, delete on public.assessment_submissions from anon, authenticated;

create index if not exists grades_transcript_lookup_idx
  on public.grades(institution_id, learner_id, status, term_id);
create index if not exists assessment_questions_order_idx
  on public.assessment_questions(institution_id, assessment_id, position);

-- Public verification uses only the SHA-256 token digest and returns a deliberately limited record.
create or replace function public.verify_certificate(p_token_hash text)
returns table(institution_name text, learner_name text, certificate_number text, certificate_type text, issued_at timestamptz, valid boolean)
language sql
stable
security definer
set search_path=public
as $$
  select i.display_name,
         concat(lr.first_name, ' ', lr.last_name),
         c.certificate_number,
         c.certificate_type,
         c.issued_at,
         (c.revoked_at is null)
    from public.certificates c
    join public.institutions i on i.id=c.institution_id
    join public.learner_records lr on lr.id=c.learner_id and lr.institution_id=c.institution_id
   where c.verification_token_hash=p_token_hash
     and i.status='active'
   limit 1
$$;
revoke all on function public.verify_certificate(text) from public, anon, authenticated;
grant execute on function public.verify_certificate(text) to service_role;
