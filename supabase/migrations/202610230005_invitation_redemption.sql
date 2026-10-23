-- Secure one-time first administrator invitation redemption.
create or replace function public.redeem_first_admin_invite(
  p_actor uuid, p_token_hash text, p_display_name text
) returns table(institution_id uuid, membership_id uuid)
language plpgsql security definer set search_path=public
as $$
declare inv public.first_admin_invites%rowtype; actor_email text; new_membership uuid;
begin
  if p_actor is null or p_token_hash is null or length(p_token_hash) <> 64
     or length(trim(coalesce(p_display_name,''))) < 2 then
    raise exception 'invalid_invitation_request' using errcode='22023';
  end if;
  select lower(email) into actor_email from auth.users where id=p_actor;
  if actor_email is null then raise exception 'authenticated_user_required' using errcode='42501'; end if;
  select * into inv from public.first_admin_invites
    where token_hash=p_token_hash for update;
  if not found or inv.redeemed_at is not null or inv.revoked_at is not null or inv.expires_at <= now() then
    raise exception 'invitation_invalid_or_expired' using errcode='22023';
  end if;
  if lower(inv.email) <> actor_email then raise exception 'invitation_email_mismatch' using errcode='42501'; end if;
  insert into public.profiles(id,display_name,email)
    values(p_actor,trim(p_display_name),actor_email)
    on conflict(id) do update set display_name=excluded.display_name,email=excluded.email,updated_at=now();
  insert into public.institution_memberships(institution_id,user_id,role,status,activated_at)
    values(inv.institution_id,p_actor,'institution_admin','active',now())
    on conflict(institution_id,user_id) do update set role='institution_admin',status='active',activated_at=now()
    returning id into new_membership;
  update public.first_admin_invites set redeemed_at=now() where id=inv.id;
  insert into public.audit_logs(actor_user_id,institution_id,action,target_type,target_id,metadata)
    values(p_actor,inv.institution_id,'first_admin_invite_redeemed','first_admin_invite',inv.id::text,
      jsonb_build_object('membership_id',new_membership,'email',actor_email));
  institution_id := inv.institution_id; membership_id := new_membership; return next;
end $$;
revoke all on function public.redeem_first_admin_invite(uuid,text,text) from public, anon, authenticated;
grant execute on function public.redeem_first_admin_invite(uuid,text,text) to service_role;
