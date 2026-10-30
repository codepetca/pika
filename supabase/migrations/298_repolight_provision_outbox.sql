-- Source only; depends on296/297. Does not enable billing or provisioning.
begin;

-- Gate changes advance an epoch instead of updating an unbounded set of rows.
create table private.repolight_provision_control (
 singleton boolean primary key default true check(singleton),epoch bigint not null default 1 check(epoch>0)
);
insert into private.repolight_provision_control default values;
alter table private.repolight_provision_control enable row level security;
revoke all on private.repolight_provision_control from public,anon,authenticated,service_role;

-- Hints contain no entitlement evidence or provider credentials. Revisions are
-- [billing revision (zero for legacy), account plan revision, entitlement revision].
create table private.repolight_provision_outbox (
 teacher_id uuid primary key references public.users(id) on delete cascade,
 source_revision text not null,eligibility_epoch bigint not null,
 state text not null default 'pending' check(state in('pending','processing','ready','ineligible','failed')),
 attempts integer not null default 0 check(attempts between 0 and 3),
 retry_round smallint not null default 0 check(retry_round between 0 and 6),
 lease_token uuid,lease_expires_at timestamptz,next_attempt_at timestamptz not null default clock_timestamp(),
 error_code text check(error_code ~ '^[a-z_]{1,64}$'),updated_at timestamptz not null default clock_timestamp(),
 check((state='processing')=(lease_token is not null and lease_expires_at is not null)),
 check(state='processing' or (lease_token is null and lease_expires_at is null))
);
alter table private.repolight_provision_outbox enable row level security;
revoke all on private.repolight_provision_outbox from public,anon,authenticated,service_role;
create index repolight_provision_outbox_due on private.repolight_provision_outbox(next_attempt_at,teacher_id) where state in('pending','processing');
create index repolight_provision_outbox_denied_epoch on private.repolight_provision_outbox(eligibility_epoch,teacher_id) where state='ineligible';

-- Three transient/uncertain attempts form one bounded burst. Retryable work
-- remains durable until success or loss of eligibility; bursts back off at
-- 1h,2h,4h,8h,16h,24h, with a saturating counter and no busy retry loop.
create function private.repolight_provision_retry_delay_v1(p_round integer)
returns interval language sql immutable set search_path='' as $$
 select least(24,1 << least(5,greatest(0,p_round))) * interval '1 hour'
$$;
revoke all on function private.repolight_provision_retry_delay_v1(integer) from public,anon,authenticated,service_role;

create function private.repolight_provision_revision_v1(p_subject uuid)
returns text language sql stable set search_path='' as $$
 select jsonb_build_array(coalesce(a.revision,0),p.revision,coalesce(e.revision,0))::text
 from public.account_plans p
 left join public.effective_feature_entitlements e on e.subject_user_id=p.subject_user_id and e.feature_key='classrooms.create'
 left join public.billing_account_access a on a.subject_user_id=p.subject_user_id
 where p.subject_user_id=p_subject
$$;
revoke all on function private.repolight_provision_revision_v1(uuid) from public,anon,authenticated,service_role;

create function private.enqueue_repolight_provision_v1(p_teacher uuid,p_revision text)
returns void language sql set search_path='' as $$
 insert into private.repolight_provision_outbox(teacher_id,source_revision,eligibility_epoch)
 select p_teacher,p_revision,epoch from private.repolight_provision_control where singleton and p_revision is not null
 on conflict(teacher_id) do update set source_revision=excluded.source_revision,eligibility_epoch=excluded.eligibility_epoch,
 state='pending',attempts=0,retry_round=0,lease_token=null,lease_expires_at=null,next_attempt_at=clock_timestamp(),error_code=null,updated_at=clock_timestamp()
 -- A delayed recovery snapshot cannot replace a newer committed plan hint.
 where ((excluded.source_revision::jsonb->>1)::bigint,(excluded.source_revision::jsonb->>0)::bigint,
  (excluded.source_revision::jsonb->>2)::bigint) >
 ((private.repolight_provision_outbox.source_revision::jsonb->>1)::bigint,
  (private.repolight_provision_outbox.source_revision::jsonb->>0)::bigint,
  (private.repolight_provision_outbox.source_revision::jsonb->>2)::bigint)
$$;
revoke all on function private.enqueue_repolight_provision_v1(uuid,text) from public,anon,authenticated,service_role;

create function private.repolight_provision_account_hint_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 -- Plan and billing writers only emit transactional hints. They never acquire
 -- settings locks or invoke the eligibility resolver/provider here. The final
 -- committed subject revision includes the current entitlement and billing row.
 if exists(select 1 from private.repolight_settings where singleton and managed_provisioning_enabled) then
  perform private.enqueue_repolight_provision_v1(new.subject_user_id,private.repolight_provision_revision_v1(new.subject_user_id));
 end if;
 return new;
end $$;
revoke all on function private.repolight_provision_account_hint_v1() from public,anon,authenticated,service_role;
create trigger repolight_provision_billing_hint after insert or update on public.billing_account_access
 for each row execute function private.repolight_provision_account_hint_v1();
create trigger repolight_provision_plan_hint after insert or update on public.account_plans
 for each row execute function private.repolight_provision_account_hint_v1();

create function private.repolight_provision_gate_hint_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if jsonb_build_array(to_jsonb(new)->'managed_provisioning_enabled',to_jsonb(new)->'billing_access_enabled',to_jsonb(new)->'legacy_plan_access_enabled',
  to_jsonb(new)->'sandbox_enabled',to_jsonb(new)->'provider_mode') is distinct from
 jsonb_build_array(to_jsonb(old)->'managed_provisioning_enabled',to_jsonb(old)->'billing_access_enabled',to_jsonb(old)->'legacy_plan_access_enabled',
  to_jsonb(old)->'sandbox_enabled',to_jsonb(old)->'provider_mode') then
  update private.repolight_provision_control set epoch=epoch+1 where singleton;
 end if;
 return new;
end $$;
revoke all on function private.repolight_provision_gate_hint_v1() from public,anon,authenticated,service_role;
create trigger repolight_provision_access_gate_hint
 after update of managed_provisioning_enabled,billing_access_enabled,legacy_plan_access_enabled on private.repolight_settings
 for each row execute function private.repolight_provision_gate_hint_v1();
create trigger repolight_provision_billing_gate_hint
 after update of sandbox_enabled,provider_mode on private.stripe_billing_settings
 for each row execute function private.repolight_provision_gate_hint_v1();

create function public.repolight_provision_outbox_v1(p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.repolight_provision_outbox; candidate record; teacher uuid; outcome text; code text; current_epoch bigint;
begin
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception using errcode='22023',message='repolight_provision_invalid_request';end if;
 select epoch into current_epoch from private.repolight_provision_control where singleton;
 if current_epoch is null then raise exception using errcode='55000',message='repolight_provision_unavailable';end if;
 if p_action='claim' then
  if exists(select 1 from jsonb_object_keys(p_payload) k where k<>'teacherId') then raise exception using errcode='22023',message='repolight_provision_invalid_request';end if;
  teacher:=(p_payload->>'teacherId')::uuid;
  if not exists(select 1 from private.repolight_settings where singleton and managed_provisioning_enabled) then return null;end if;
  -- Discover both existing billing/trial accounts and explicitly enabled legacy
  -- Plus/Pro accounts. This is a hint filter;297 still proves exact eligibility.
  for candidate in
   select p.subject_user_id,private.repolight_provision_revision_v1(p.subject_user_id) revision
   from public.account_plans p join public.users u on u.id=p.subject_user_id
   left join public.billing_account_access a on a.subject_user_id=p.subject_user_id
   left join public.effective_feature_entitlements e on e.subject_user_id=p.subject_user_id and e.feature_key='classrooms.create'
   where (teacher is null or p.subject_user_id=teacher) and p.plan_key in('plus','pro')
    and ((p.management_source in('billing','trial') and a.starts_at<=clock_timestamp() and a.access_ends_at>clock_timestamp())
      or (p.management_source='legacy' and a.subject_user_id is null and e.enabled and e.source='plan'
       and e.starts_at<=clock_timestamp() and (e.expires_at is null or e.expires_at>clock_timestamp())
       and exists(select 1 from private.repolight_settings where singleton and legacy_plan_access_enabled)))
    and not exists(select 1 from private.repolight_provision_outbox q where q.teacher_id=p.subject_user_id
      and q.source_revision=private.repolight_provision_revision_v1(p.subject_user_id))
   order by p.subject_user_id limit 25
  loop perform private.enqueue_repolight_provision_v1(candidate.subject_user_id,candidate.revision);end loop;
  -- Denials from old gate epochs are repaired lazily in bounded batches. Active
  -- workers keep their lease; a denial finishing after repair is discovered by
  -- this same epoch predicate on the next claim, even if it missed the scan.
  with repair as (
   select teacher_id from private.repolight_provision_outbox where (teacher is null or teacher_id=teacher)
    and state='ineligible' and eligibility_epoch<current_epoch order by eligibility_epoch,teacher_id limit 25 for update skip locked
  ) update private.repolight_provision_outbox q set state='pending',attempts=0,eligibility_epoch=current_epoch,
   next_attempt_at=clock_timestamp(),error_code=null,updated_at=clock_timestamp() from repair where q.teacher_id=repair.teacher_id;
  with exhausted as (
   select teacher_id from private.repolight_provision_outbox where (teacher is null or teacher_id=teacher) and attempts>=3
    and (state='pending' or state='processing' and lease_expires_at<=clock_timestamp())
   order by next_attempt_at,teacher_id limit 25 for update skip locked
  ) update private.repolight_provision_outbox q set state='pending',attempts=0,retry_round=least(6,q.retry_round+1),
   lease_token=null,lease_expires_at=null,next_attempt_at=clock_timestamp()+private.repolight_provision_retry_delay_v1(q.retry_round),
   error_code='repolight_provision_retry_cooldown',updated_at=clock_timestamp() from exhausted where q.teacher_id=exhausted.teacher_id;
  select * into r from private.repolight_provision_outbox
   where (teacher is null or teacher_id=teacher) and attempts<3
    and (state='pending' and next_attempt_at<=clock_timestamp() or state='processing' and lease_expires_at<=clock_timestamp())
   order by next_attempt_at,teacher_id limit 1 for update skip locked;
  if not found then return null;end if;
  update private.repolight_provision_outbox set state='processing',attempts=attempts+1,eligibility_epoch=current_epoch,lease_token=gen_random_uuid(),
   lease_expires_at=clock_timestamp()+interval '90 seconds',updated_at=clock_timestamp() where teacher_id=r.teacher_id returning * into r;
  return jsonb_build_object('teacherId',r.teacher_id,'leaseToken',r.lease_token,'attempt',r.attempts);
 elsif p_action='finish' then
  if not(p_payload ?& array['teacherId','leaseToken','outcome']) or exists(select 1 from jsonb_object_keys(p_payload) k where k<>all(array['teacherId','leaseToken','outcome','errorCode'])) then raise exception using errcode='22023',message='repolight_provision_invalid_request';end if;
  outcome:=p_payload->>'outcome';code:=p_payload->>'errorCode';
  if outcome is null or outcome not in('ready','ineligible','retry','failed') or (code is not null and code !~ '^[a-z_]{1,64}$') then raise exception using errcode='22023',message='repolight_provision_invalid_request';end if;
  update private.repolight_provision_outbox set
   state=case when outcome='ineligible' and eligibility_epoch<current_epoch then 'pending'
    when outcome='retry' then 'pending' else outcome end,
   attempts=case when outcome='ineligible' and eligibility_epoch<current_epoch or outcome='retry' and attempts>=3 then 0 else attempts end,
   retry_round=case when outcome='retry' and attempts>=3 then least(6,retry_round+1) else retry_round end,
   lease_token=null,lease_expires_at=null,
   next_attempt_at=case when outcome='ineligible' and eligibility_epoch<current_epoch then clock_timestamp()
    when outcome='retry' and attempts>=3 then clock_timestamp()+private.repolight_provision_retry_delay_v1(retry_round)
    else clock_timestamp()+interval '5 minutes' end,
   error_code=code,updated_at=clock_timestamp()
   where teacher_id=(p_payload->>'teacherId')::uuid and state='processing'
    and lease_token=(p_payload->>'leaseToken')::uuid and lease_expires_at>clock_timestamp();
  return jsonb_build_object('acknowledged',found);
 else raise exception using errcode='22023',message='repolight_provision_invalid_request';end if;
end $$;
revoke all on function public.repolight_provision_outbox_v1(text,jsonb) from public,anon,authenticated;
grant execute on function public.repolight_provision_outbox_v1(text,jsonb) to service_role;
commit;
