-- Platform-owner subscription controls. No expiry-driven automatic termination.
create or replace function public.platform_manage_subscription(
 p_actor uuid,p_subscription uuid,p_action text,p_extend_until date,p_reason text
) returns public.institution_subscriptions
language plpgsql security definer set search_path=public
as $$
declare s public.institution_subscriptions%rowtype; old_status public.subscription_status;
begin
 if not exists(select 1 from public.platform_memberships where user_id=p_actor and role='platform_owner') then
   raise exception 'platform_owner_required' using errcode='42501';
 end if;
 if p_action not in ('extend','terminate','restore_overdue') then
   raise exception 'invalid_subscription_action' using errcode='22023';
 end if;
 select * into s from public.institution_subscriptions where id=p_subscription for update;
 if not found then raise exception 'subscription_not_found' using errcode='P0002'; end if;
 old_status:=s.status;
 if p_action='extend' then
   if p_extend_until is null or p_extend_until < current_date then raise exception 'extension_date_must_be_future' using errcode='22023'; end if;
   update public.institution_subscriptions set period_end=p_extend_until,grace_end=p_extend_until+7,
     extended_until=p_extend_until,status='active',owner_decision_required=false,terminated_at=null,terminated_by=null,updated_at=now()
   where id=p_subscription returning * into s;
 elsif p_action='terminate' then
   update public.institution_subscriptions set status='terminated',terminated_at=now(),terminated_by=p_actor,
     owner_decision_required=false,updated_at=now() where id=p_subscription returning * into s;
   -- Keep institution and academic records; only mark the institution as terminated.
   update public.institutions set status='terminated',updated_at=now() where id=s.institution_id;
 else
   if s.status not in ('overdue','grace_period') then raise exception 'subscription_not_overdue' using errcode='22023'; end if;
   update public.institution_subscriptions set status='active',owner_decision_required=false,updated_at=now()
   where id=p_subscription returning * into s;
 end if;
 insert into public.audit_logs(actor_user_id,institution_id,action,target_type,target_id,metadata)
 values(p_actor,s.institution_id,'subscription_'||p_action,'institution_subscription',s.id::text,
 jsonb_build_object('previous_status',old_status,'new_status',s.status,'period_end',s.period_end,'reason',left(coalesce(p_reason,''),1000)));
 return s;
end $$;
revoke all on function public.platform_manage_subscription(uuid,uuid,text,date,text) from public,anon,authenticated;
grant execute on function public.platform_manage_subscription(uuid,uuid,text,date,text) to service_role;
