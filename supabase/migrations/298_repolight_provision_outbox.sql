-- Source only; depends on296/297. Does not enable billing or provisioning.
begin;
alter table private.repolight_settings add column managed_provisioning_enabled boolean not null default false;

-- This queue contains hints, never entitlement evidence or provider credentials.
-- New billing revisions replace obsolete hints and fence their acknowledgements.
create table private.repolight_provision_outbox (
 teacher_id uuid primary key references public.users(id) on delete cascade,
 source_revision text not null,
 state text not null default 'pending' check(state in('pending','processing','ready','ineligible','failed')),
 attempts integer not null default 0 check(attempts between 0 and 3),
 lease_token uuid,lease_expires_at timestamptz,next_attempt_at timestamptz not null default clock_timestamp(),
 error_code text check(error_code ~ '^[a-z_]{1,64}$'),updated_at timestamptz not null default clock_timestamp(),
 check((state='processing')=(lease_token is not null and lease_expires_at is not null)),
 check(state='processing' or (lease_token is null and lease_expires_at is null))
);
alter table private.repolight_provision_outbox enable row level security;
revoke all on private.repolight_provision_outbox from public,anon,authenticated,service_role;
create index repolight_provision_outbox_due on private.repolight_provision_outbox(next_attempt_at,teacher_id) where state in('pending','processing');

create function private.repolight_provision_revision_v1(p_access public.billing_account_access)
returns text language sql immutable set search_path='' as $$
 select jsonb_build_array(p_access.revision,p_access.account_plan_revision,p_access.entitlement_revision)::text
$$;
revoke all on function private.repolight_provision_revision_v1(public.billing_account_access) from public,anon,authenticated,service_role;

create function private.enqueue_repolight_provision_v1(p_teacher uuid,p_revision text)
returns void language sql set search_path='' as $$
 insert into private.repolight_provision_outbox(teacher_id,source_revision) values(p_teacher,p_revision)
 on conflict(teacher_id) do update set source_revision=excluded.source_revision,state='pending',attempts=0,
 lease_token=null,lease_expires_at=null,next_attempt_at=clock_timestamp(),error_code=null,updated_at=clock_timestamp()
 -- Recovery can wait behind a newer billing transaction. Numeric revision
 -- ordering prevents its older snapshot from replacing that committed hint.
 where ((excluded.source_revision::jsonb->>1)::bigint,(excluded.source_revision::jsonb->>0)::bigint,
  coalesce((excluded.source_revision::jsonb->>2)::bigint,0)) >
 ((private.repolight_provision_outbox.source_revision::jsonb->>1)::bigint,
  (private.repolight_provision_outbox.source_revision::jsonb->>0)::bigint,
  coalesce((private.repolight_provision_outbox.source_revision::jsonb->>2)::bigint,0))
$$;
revoke all on function private.enqueue_repolight_provision_v1(uuid,text) from public,anon,authenticated,service_role;

create function private.repolight_provision_billing_hint_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 -- No resolver/provider calls and no settings locks in a billing transaction.
 -- INSERT may precede the entitlement write; the committed worker rechecks all
 -- exact plan/version/trial/receipt facts through registry.ensure instead.
 if exists(select 1 from private.repolight_settings where singleton and managed_provisioning_enabled) then
  perform private.enqueue_repolight_provision_v1(new.subject_user_id,private.repolight_provision_revision_v1(new));
 end if;
 return new;
end $$;
revoke all on function private.repolight_provision_billing_hint_v1() from public,anon,authenticated,service_role;
create trigger repolight_provision_billing_hint after insert or update on public.billing_account_access
 for each row execute function private.repolight_provision_billing_hint_v1();

create function private.repolight_provision_gate_hint_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 -- A new rollout eligibility epoch may make an unchanged account revision
 -- eligible. Reset denials only; never revive exhausted/invalid operations.
 if jsonb_build_array(to_jsonb(new)->'managed_provisioning_enabled',to_jsonb(new)->'billing_access_enabled',
  to_jsonb(new)->'sandbox_enabled',to_jsonb(new)->'provider_mode') is distinct from
 jsonb_build_array(to_jsonb(old)->'managed_provisioning_enabled',to_jsonb(old)->'billing_access_enabled',
  to_jsonb(old)->'sandbox_enabled',to_jsonb(old)->'provider_mode') then
  update private.repolight_provision_outbox set state='pending',attempts=0,
   lease_token=null,lease_expires_at=null,next_attempt_at=clock_timestamp(),error_code=null,updated_at=clock_timestamp()
   where state='ineligible';
 end if;
 return new;
end $$;
revoke all on function private.repolight_provision_gate_hint_v1() from public,anon,authenticated,service_role;
create trigger repolight_provision_access_gate_hint
 after update of managed_provisioning_enabled,billing_access_enabled on private.repolight_settings
 for each row execute function private.repolight_provision_gate_hint_v1();
create trigger repolight_provision_billing_gate_hint
 after update of sandbox_enabled,provider_mode on private.stripe_billing_settings
 for each row execute function private.repolight_provision_gate_hint_v1();

create function public.repolight_provision_outbox_v1(p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.repolight_provision_outbox; candidate record; teacher uuid; outcome text; code text;
begin
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception using errcode='22023',message='repolight_provision_invalid_request';end if;
 if p_action='claim' then
  if exists(select 1 from jsonb_object_keys(p_payload) k where k<>'teacherId') then raise exception using errcode='22023',message='repolight_provision_invalid_request';end if;
  teacher:=(p_payload->>'teacherId')::uuid;
  -- Runtime and DB gates are independent. An absent DB row fails closed.
  if not exists(select 1 from private.repolight_settings where singleton and managed_provisioning_enabled) then return null;end if;
  -- Bounded recovery also discovers active revisions predating flag activation,
  -- entitlement repair or an earlier rollout. A terminal identical revision is
  -- never reset here; otherwise retries could continue indefinitely.
  for candidate in
   select a.subject_user_id,private.repolight_provision_revision_v1(a) revision
   from public.billing_account_access a
   join public.users u on u.id=a.subject_user_id
   where (teacher is null or a.subject_user_id=teacher)
    and a.starts_at<=clock_timestamp() and a.access_ends_at>clock_timestamp()
    and not exists(select 1 from private.repolight_provision_outbox q where q.teacher_id=a.subject_user_id
      and q.source_revision=private.repolight_provision_revision_v1(a))
   order by a.subject_user_id limit 25
  loop perform private.enqueue_repolight_provision_v1(candidate.subject_user_id,candidate.revision);end loop;
  -- A killed third attempt has no later retry and must become inspectable.
  update private.repolight_provision_outbox set state='failed',lease_token=null,lease_expires_at=null,
   error_code='repolight_provision_attempts_exhausted',updated_at=clock_timestamp()
   where (teacher is null or teacher_id=teacher) and attempts>=3
    and (state='pending' or state='processing' and lease_expires_at<=clock_timestamp());
  select * into r from private.repolight_provision_outbox
   where (teacher is null or teacher_id=teacher) and attempts<3
    and (state='pending' and next_attempt_at<=clock_timestamp() or state='processing' and lease_expires_at<=clock_timestamp())
   order by next_attempt_at,teacher_id limit 1 for update skip locked;
  if not found then return null;end if;
  update private.repolight_provision_outbox set state='processing',attempts=attempts+1,lease_token=gen_random_uuid(),
   lease_expires_at=clock_timestamp()+interval '90 seconds',updated_at=clock_timestamp() where teacher_id=r.teacher_id returning * into r;
  return jsonb_build_object('teacherId',r.teacher_id,'leaseToken',r.lease_token,'attempt',r.attempts);
 elsif p_action='finish' then
  if not(p_payload ?& array['teacherId','leaseToken','outcome']) or exists(select 1 from jsonb_object_keys(p_payload) k where k<>all(array['teacherId','leaseToken','outcome','errorCode'])) then raise exception using errcode='22023',message='repolight_provision_invalid_request';end if;
  outcome:=p_payload->>'outcome';code:=p_payload->>'errorCode';
  if outcome is null or outcome not in('ready','ineligible','retry','failed') or (code is not null and code !~ '^[a-z_]{1,64}$') then raise exception using errcode='22023',message='repolight_provision_invalid_request';end if;
  update private.repolight_provision_outbox set
   state=case when outcome='retry' then case when attempts<3 then 'pending' else 'failed' end else outcome end,
   lease_token=null,lease_expires_at=null,next_attempt_at=clock_timestamp()+interval '5 minutes',error_code=code,updated_at=clock_timestamp()
   where teacher_id=(p_payload->>'teacherId')::uuid and state='processing'
    and lease_token=(p_payload->>'leaseToken')::uuid and lease_expires_at>clock_timestamp();
  return jsonb_build_object('acknowledged',found);
 else raise exception using errcode='22023',message='repolight_provision_invalid_request';end if;
end $$;
revoke all on function public.repolight_provision_outbox_v1(text,jsonb) from public,anon,authenticated;
grant execute on function public.repolight_provision_outbox_v1(text,jsonb) to service_role;
commit;
