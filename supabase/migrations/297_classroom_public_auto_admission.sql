-- Public admission is independently disabled by default. No users are admitted here.
begin;

create table private.classroom_public_auto_admission_policy (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false
);
insert into private.classroom_public_auto_admission_policy(singleton) values (true);
alter table private.classroom_public_auto_admission_policy enable row level security;
revoke all on private.classroom_public_auto_admission_policy from public, anon, authenticated, service_role;

-- Extend only the two migration-294 kind-dependent checks. Fail on drift.
do $migration$
declare n integer;
begin
  -- Pin both affected checks and the separate revision check; do not drop a
  -- similarly named or semantically changed production constraint.
  select count(*) into n from pg_catalog.pg_constraint
  where conrelid = 'private.classroom_experience_admission_batches'::regclass
    and contype = 'c' and convalidated and (
      (conname = 'classroom_experience_admission_batches_kind_check'
       and pg_catalog.pg_get_constraintdef(oid) = $def$CHECK ((kind = ANY (ARRAY['bootstrap'::text, 'operator'::text, 'growth_on'::text, 'growth_off'::text])))$def$)
      or (conname = 'classroom_experience_admission_batches_check2'
       and pg_catalog.pg_get_constraintdef(oid) = $def$CHECK ((((kind = 'bootstrap'::text) AND (admitted_count = 70)) OR ((kind = 'operator'::text) AND (admitted_count > 0) AND (excluded_count = 0)) OR ((kind = ANY (ARRAY['growth_on'::text, 'growth_off'::text])) AND (admitted_count = 0) AND (excluded_count = 0))))$def$)
      or (conname = 'classroom_experience_admission_batches_check1'
       and pg_catalog.pg_get_constraintdef(oid) = $def$CHECK (((expected_revision <= predecessor_revision) AND ((kind = 'growth_off'::text) OR (expected_revision = predecessor_revision))))$def$)
    );
  if n <> 3 then raise exception 'classroom_admission_batch_constraints_drift'; end if;
end
$migration$;
alter table private.classroom_experience_admission_batches
  drop constraint classroom_experience_admission_batches_kind_check,
  drop constraint classroom_experience_admission_batches_check2;
alter table private.classroom_experience_admission_batches
  add constraint classroom_admission_batch_kind_v3 check (kind in ('bootstrap','operator','growth_on','growth_off','automatic')),
  add constraint classroom_admission_batch_count_v3 check (
    (kind = 'bootstrap' and admitted_count = 70)
    or (kind = 'operator' and admitted_count > 0 and excluded_count = 0)
    or (kind = 'automatic' and admitted_count = 1 and excluded_count = 0)
    or (kind in ('growth_on','growth_off') and admitted_count = 0 and excluded_count = 0));

-- The master growth stop also switches off auto admission. Future growth_on
-- therefore never silently re-enables the independently controlled policy.
create function private.classroom_auto_admission_master_stop_v1()
returns trigger language plpgsql set search_path = '' as $function$
begin
  if old.growth_enabled and not new.growth_enabled then
    update private.classroom_public_auto_admission_policy set enabled = false where singleton;
    if not found then raise exception using errcode = 'PT503', message = 'classroom_auto_policy_unavailable'; end if;
  end if;
  return new;
end
$function$;
create trigger classroom_auto_admission_master_stop after update
  on private.classroom_experience_admission_policy for each row
  execute function private.classroom_auto_admission_master_stop_v1();
revoke all on function private.classroom_auto_admission_master_stop_v1() from public, anon, authenticated, service_role;

create function public.set_classroom_auto_admission_enabled_v1(p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare policy private.classroom_experience_admission_policy%rowtype;
begin
  if p_enabled is null then raise exception using errcode = '22023', message = 'classroom_auto_policy_invalid'; end if;
  select * into policy from private.classroom_experience_admission_policy where singleton for update;
  if not found or not policy.bootstrap_initialized then
    raise exception using errcode = 'PT503', message = 'classroom_admission_registry_unavailable';
  end if;
  if p_enabled and not policy.growth_enabled then
    raise exception using errcode = '55000', message = 'classroom_admission_growth_stopped';
  end if;
  update private.classroom_public_auto_admission_policy set enabled = p_enabled where singleton;
  if not found then raise exception using errcode = 'PT503', message = 'classroom_auto_policy_unavailable'; end if;
  return jsonb_build_object('version',1,'enabled',p_enabled);
end
$function$;

create function public.ensure_verified_classroom_admission_v1(p_actor_id uuid, p_bootstrap_manifest_sha256 text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  policy private.classroom_experience_admission_policy%rowtype;
  auto_enabled boolean;
  verified boolean;
  operation_id uuid;
  manifest text;
  request_hash text;
  batch_result jsonb;
  outcome text;
begin
  if p_actor_id is null then raise exception using errcode = '22023', message = 'classroom_admission_actor_required'; end if;
  select * into policy from private.classroom_experience_admission_policy where singleton for update;
  if not found or not policy.bootstrap_initialized then
    raise exception using errcode = 'PT503', message = 'classroom_admission_registry_unavailable';
  end if;
  if p_bootstrap_manifest_sha256 is null or p_bootstrap_manifest_sha256 !~ '^[a-f0-9]{64}$'
    or p_bootstrap_manifest_sha256 is distinct from policy.bootstrap_manifest_sha256 then
    raise exception using errcode = 'PT503', message = 'classroom_admission_registry_unavailable';
  end if;
  select enabled into auto_enabled from private.classroom_public_auto_admission_policy where singleton for update;
  if not found then raise exception using errcode = 'PT503', message = 'classroom_auto_policy_unavailable'; end if;
  select (email_verified_at is not null) into verified from public.users where id = p_actor_id for share;
  if not coalesce(verified,false) then outcome := 'unverified';
  elsif exists(select 1 from private.classroom_experience_admission_exclusions where user_id = p_actor_id) then outcome := 'excluded';
  elsif exists(select 1 from private.classroom_experience_admission_grants where user_id = p_actor_id) then outcome := 'already_admitted';
  elsif not policy.growth_enabled or not auto_enabled then outcome := 'growth_stopped';
  else
    if policy.registry_revision >= 9007199254740990 then
      raise exception using errcode = '55000', message = 'classroom_admission_revision_exhausted';
    end if;
    operation_id := pg_catalog.gen_random_uuid();
    manifest := private.classroom_experience_admission_manifest_v2('automatic',array[p_actor_id],array[]::uuid[]);
    request_hash := encode(extensions.digest(convert_to(jsonb_build_array('classroom-auto-admission-v1',operation_id,p_actor_id,policy.registry_revision)::text,'UTF8'),'sha256'),'hex');
    batch_result := jsonb_build_object('version',2,'operation_id',operation_id,'kind','automatic',
      'requested_revision',policy.registry_revision,'predecessor_revision',policy.registry_revision,
      'registry_revision',policy.registry_revision + 1,'manifest_sha256',manifest,
      'admitted_count',1,'excluded_count',0,'growth_enabled',true,'bootstrap_initialized',true);
    insert into private.classroom_experience_admission_batches(operation_id,expected_revision,predecessor_revision,
      registry_revision,kind,manifest_sha256,request_sha256,admitted_count,excluded_count,approval_ref,result)
    values(operation_id,policy.registry_revision,policy.registry_revision,policy.registry_revision + 1,'automatic',
      manifest,request_hash,1,0,'public-verified-v1',batch_result);
    insert into private.classroom_experience_admission_grants(user_id,origin_operation_id,registry_revision)
    values(p_actor_id,operation_id,policy.registry_revision + 1);
    update private.classroom_experience_admission_policy set registry_revision = policy.registry_revision + 1 where singleton;
    outcome := 'admitted';
    policy.registry_revision := policy.registry_revision + 1;
  end if;
  return jsonb_build_object('version',1,'outcome',outcome,'registry_revision',policy.registry_revision);
end
$function$;
-- A display hint only. The write RPC always repeats every check under its locks.
create function public.read_verified_classroom_auto_admission_eligibility_v1(p_actor_id uuid, p_bootstrap_manifest_sha256 text)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare initialized boolean; eligible boolean; actual_manifest text;
begin
  if p_actor_id is null then raise exception using errcode = '22023', message = 'classroom_admission_actor_required'; end if;
  select p.bootstrap_initialized, p.bootstrap_manifest_sha256,
    (p.growth_enabled and a.enabled and u.email_verified_at is not null
     and e.user_id is null and g.user_id is null)
  into initialized, actual_manifest, eligible
  from private.classroom_experience_admission_policy p
  join private.classroom_public_auto_admission_policy a on a.singleton
  left join public.users u on u.id = p_actor_id
  left join private.classroom_experience_admission_exclusions e on e.user_id = p_actor_id
  left join private.classroom_experience_admission_grants g on g.user_id = p_actor_id
  where p.singleton;
  if not found or not initialized or p_bootstrap_manifest_sha256 is null
    or p_bootstrap_manifest_sha256 !~ '^[a-f0-9]{64}$'
    or p_bootstrap_manifest_sha256 is distinct from actual_manifest then
    raise exception using errcode = 'PT503', message = 'classroom_admission_registry_unavailable';
  end if;
  return jsonb_build_object('version',1,'eligible',coalesce(eligible,false));
end
$function$;
revoke all on function public.set_classroom_auto_admission_enabled_v1(boolean),
  public.ensure_verified_classroom_admission_v1(uuid,text),
  public.read_verified_classroom_auto_admission_eligibility_v1(uuid,text) from public, anon, authenticated, service_role;
grant execute on function public.set_classroom_auto_admission_enabled_v1(boolean),
  public.ensure_verified_classroom_admission_v1(uuid,text),
  public.read_verified_classroom_auto_admission_eligibility_v1(uuid,text) to service_role;
commit;
