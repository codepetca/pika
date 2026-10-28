-- Inactive stage-0 registry. No account grants, activation, provider or signup hooks.
begin;

create table private.classroom_experience_admission_policy (
  singleton boolean primary key default true check (singleton),
  registry_revision bigint not null default 0 check (registry_revision between 0 and 9007199254740991),
  growth_enabled boolean not null default false,
  bootstrap_initialized boolean not null default false,
  bootstrap_manifest_sha256 text,
  -- Keep one safe increment available to stop new grants at the revision ceiling.
  check (registry_revision < 9007199254740991 or not growth_enabled),
  check ((not bootstrap_initialized and registry_revision = 0 and not growth_enabled and bootstrap_manifest_sha256 is null)
    or (bootstrap_initialized and registry_revision >= 1 and bootstrap_manifest_sha256 is not null and bootstrap_manifest_sha256 ~ '^[a-f0-9]{64}$'))
);
insert into private.classroom_experience_admission_policy(singleton) values (true);

create table private.classroom_experience_admission_batches (
  operation_id uuid primary key,
  expected_revision bigint not null check (expected_revision between 0 and 9007199254740990),
  predecessor_revision bigint not null check (predecessor_revision between 0 and 9007199254740990),
  registry_revision bigint not null unique check (registry_revision between 1 and 9007199254740991),
  kind text not null check (kind in ('bootstrap','operator','growth_on','growth_off')),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
  admitted_count integer not null check (admitted_count between 0 and 5000),
  excluded_count integer not null check (excluded_count between 0 and 5000),
  approval_ref text not null check (approval_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'),
  result jsonb not null,
  committed_at timestamptz not null default clock_timestamp(),
  check (registry_revision = predecessor_revision + 1),
  check (expected_revision <= predecessor_revision and (kind = 'growth_off' or expected_revision = predecessor_revision)),
  check ((kind = 'bootstrap' and admitted_count = 70)
    or (kind = 'operator' and admitted_count > 0 and excluded_count = 0)
    or (kind in ('growth_on','growth_off') and admitted_count = 0 and excluded_count = 0))
);
create unique index classroom_experience_admission_one_bootstrap
  on private.classroom_experience_admission_batches(kind) where kind = 'bootstrap';

create table private.classroom_experience_admission_grants (
  user_id uuid primary key references public.users(id),
  origin_operation_id uuid not null references private.classroom_experience_admission_batches(operation_id),
  registry_revision bigint not null references private.classroom_experience_admission_batches(registry_revision),
  admitted_at timestamptz not null default clock_timestamp()
);
create table private.classroom_experience_admission_exclusions (
  user_id uuid primary key references public.users(id),
  origin_operation_id uuid not null references private.classroom_experience_admission_batches(operation_id),
  recorded_at timestamptz not null default clock_timestamp()
);

alter table private.classroom_experience_admission_policy enable row level security;
alter table private.classroom_experience_admission_batches enable row level security;
alter table private.classroom_experience_admission_grants enable row level security;
alter table private.classroom_experience_admission_exclusions enable row level security;
revoke all on private.classroom_experience_admission_policy,
  private.classroom_experience_admission_batches, private.classroom_experience_admission_grants,
  private.classroom_experience_admission_exclusions from public, anon, authenticated, service_role;

-- Canonical set digest is shared with private manifest tooling; never JSON key order.
create function private.classroom_experience_admission_manifest_v2(p_kind text, p_users uuid[], p_excluded uuid[])
returns text language sql immutable set search_path = '' as $function$
  select encode(extensions.digest(convert_to(
    'classroom-admission-v2' || E'\n' || p_kind || E'\n' ||
    coalesce((select string_agg(u::text, E'\n' order by u::text collate "C") from unnest(p_users) u), '') ||
    E'\n--excluded--\n' ||
    coalesce((select string_agg(u::text, E'\n' order by u::text collate "C") from unnest(p_excluded) u), ''),
    'UTF8'), 'sha256'), 'hex')
$function$;

-- Append-only evidence and origin. No registry API revokes or deletes admissions.
create function private.classroom_experience_admission_immutable_v2()
returns trigger language plpgsql set search_path = '' as $function$
begin
  raise exception using errcode = '55000', message = 'classroom_admission_record_immutable';
end
$function$;
create trigger classroom_admission_batch_immutable before update or delete
  on private.classroom_experience_admission_batches for each row
  execute function private.classroom_experience_admission_immutable_v2();
create trigger classroom_admission_grant_immutable before update or delete
  on private.classroom_experience_admission_grants for each row
  execute function private.classroom_experience_admission_immutable_v2();
create trigger classroom_admission_exclusion_immutable before update or delete
  on private.classroom_experience_admission_exclusions for each row
  execute function private.classroom_experience_admission_immutable_v2();

-- Even owner maintenance cannot silently reset initialization or reclassify bootstrap.
create function private.classroom_experience_admission_policy_guard_v2()
returns trigger language plpgsql set search_path = '' as $function$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'classroom_admission_policy_immutable';
  end if;
  if new.singleton is distinct from old.singleton
    or new.registry_revision <> old.registry_revision + 1
    or not new.bootstrap_initialized
    or (old.bootstrap_initialized and new.bootstrap_manifest_sha256 is distinct from old.bootstrap_manifest_sha256)
    or (not old.bootstrap_initialized and new.growth_enabled) then
    raise exception using errcode = '55000', message = 'classroom_admission_policy_immutable';
  end if;
  return new;
end
$function$;
create trigger classroom_admission_policy_guard before update or delete
  on private.classroom_experience_admission_policy for each row
  execute function private.classroom_experience_admission_policy_guard_v2();

create function public.read_classroom_experience_admission_v2(p_actor_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare decision jsonb;
begin
  if p_actor_id is null then
    raise exception using errcode = '22023', message = 'classroom_admission_actor_required';
  end if;
  -- One snapshot and indexed actor lookup. Origin is immutable, growth never affects reads.
  select case when p.bootstrap_initialized then jsonb_build_object(
    'version', 2, 'registry_revision', p.registry_revision,
    'bootstrap_manifest_sha256', p.bootstrap_manifest_sha256,
    'actor_id', p_actor_id, 'admitted', g.user_id is not null,
    'bootstrap_member', coalesce(b.kind = 'bootstrap', false)) end
  into decision
  from private.classroom_experience_admission_policy p
  left join private.classroom_experience_admission_grants g on g.user_id = p_actor_id
  left join private.classroom_experience_admission_batches b on b.operation_id = g.origin_operation_id
  where p.singleton;
  if decision is null then
    raise exception using errcode = 'PT503', message = 'classroom_admission_registry_uninitialized';
  end if;
  return decision;
end
$function$;

create function public.commit_classroom_experience_admission_batch_v2(
  p_operation_id uuid, p_expected_revision bigint, p_kind text,
  p_user_ids uuid[], p_excluded_user_ids uuid[], p_manifest_sha256 text, p_approval_ref text
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  policy private.classroom_experience_admission_policy%rowtype;
  saved private.classroom_experience_admission_batches%rowtype;
  request_hash text;
  result jsonb;
  user_count integer;
  excluded_count integer;
begin
  if p_operation_id is null or p_expected_revision is null
    or p_expected_revision not between 0 and 9007199254740991
    or p_kind is null or p_kind not in ('bootstrap','operator','growth_on','growth_off')
    or p_user_ids is null or p_excluded_user_ids is null
    or coalesce(array_ndims(p_user_ids),1) <> 1 or coalesce(array_ndims(p_excluded_user_ids),1) <> 1
    or p_manifest_sha256 is null or p_manifest_sha256 !~ '^[a-f0-9]{64}$'
    or p_approval_ref is null or p_approval_ref !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'
  then raise exception using errcode = '22023', message = 'classroom_admission_batch_invalid'; end if;
  user_count := cardinality(p_user_ids);
  excluded_count := cardinality(p_excluded_user_ids);
  if user_count + excluded_count > 5000
    or exists(select 1 from unnest(p_user_ids) u where u is null)
    or exists(select 1 from unnest(p_excluded_user_ids) u where u is null)
    or (select count(distinct u) from unnest(p_user_ids) u) <> user_count
    or (select count(distinct u) from unnest(p_excluded_user_ids) u) <> excluded_count
    or p_user_ids && p_excluded_user_ids
    or (p_kind = 'bootstrap' and user_count <> 70)
    or (p_kind = 'operator' and (user_count = 0 or excluded_count <> 0))
    or (p_kind in ('growth_on','growth_off') and (user_count <> 0 or excluded_count <> 0))
    or private.classroom_experience_admission_manifest_v2(p_kind,p_user_ids,p_excluded_user_ids) <> p_manifest_sha256
  then raise exception using errcode = '22023', message = 'classroom_admission_manifest_invalid'; end if;

  -- JSON array order is intentional: the retry must repeat the exact input payload,
  -- including expected revision and approval; manifest order alone is set-canonical.
  request_hash := encode(extensions.digest(convert_to(jsonb_build_array(
    'classroom-admission-request-v2',p_operation_id,p_expected_revision,p_kind,
    p_user_ids,p_excluded_user_ids,p_manifest_sha256,p_approval_ref)::text,'UTF8'),'sha256'),'hex');
  select * into policy from private.classroom_experience_admission_policy where singleton for update;
  if not found then raise exception using errcode = 'PT503', message = 'classroom_admission_registry_unavailable'; end if;
  select * into saved from private.classroom_experience_admission_batches where operation_id = p_operation_id;
  if found then
    if saved.request_sha256 <> request_hash then
      raise exception using errcode = '23505', message = 'classroom_admission_operation_conflict';
    end if;
    return saved.result;
  end if;
  -- Restrictive stops have priority after any intervening commit. Other writes
  -- retain strict CAS; no future-observed revision can manufacture authority.
  if (p_kind = 'growth_off' and p_expected_revision > policy.registry_revision)
    or (p_kind <> 'growth_off' and p_expected_revision <> policy.registry_revision) then
    raise exception using errcode = '40001', message = 'classroom_admission_revision_conflict';
  end if;
  if policy.registry_revision >= 9007199254740991
    or (p_kind <> 'growth_off' and policy.registry_revision = 9007199254740990) then
    raise exception using errcode = '55000', message = 'classroom_admission_revision_exhausted';
  end if;
  if p_kind = 'bootstrap' then
    if policy.bootstrap_initialized then
      raise exception using errcode = '55000', message = 'classroom_admission_bootstrap_already_initialized';
    end if;
  elsif not policy.bootstrap_initialized then
    raise exception using errcode = 'PT503', message = 'classroom_admission_registry_uninitialized';
  elsif p_kind = 'operator' and not policy.growth_enabled then
    raise exception using errcode = '55000', message = 'classroom_admission_growth_stopped';
  end if;
  -- Resolve every canonical local identity and conflict before inserting any row.
  if exists(select 1 from unnest(p_user_ids || p_excluded_user_ids) u
    where not exists(select 1 from public.users a where a.id = u)) then
    raise exception using errcode = '23503', message = 'classroom_admission_unknown_user';
  end if;
  if exists(select 1 from private.classroom_experience_admission_grants g where g.user_id = any(p_user_ids))
    or exists(select 1 from private.classroom_experience_admission_exclusions e where e.user_id = any(p_user_ids)) then
    raise exception using errcode = '23505', message = 'classroom_admission_identity_conflict';
  end if;
  result := jsonb_build_object('version',2,'operation_id',p_operation_id,'kind',p_kind,
    'requested_revision',p_expected_revision,'predecessor_revision',policy.registry_revision,
    'registry_revision',policy.registry_revision + 1,'manifest_sha256',p_manifest_sha256,
    'admitted_count',user_count,'excluded_count',excluded_count,
    'growth_enabled',case when p_kind = 'growth_on' then true when p_kind in ('bootstrap','growth_off') then false else policy.growth_enabled end,
    'bootstrap_initialized',true);
  insert into private.classroom_experience_admission_batches(
    operation_id,expected_revision,predecessor_revision,registry_revision,kind,manifest_sha256,request_sha256,
    admitted_count,excluded_count,approval_ref,result)
  values(p_operation_id,p_expected_revision,policy.registry_revision,policy.registry_revision + 1,p_kind,p_manifest_sha256,
    request_hash,user_count,excluded_count,p_approval_ref,result);
  insert into private.classroom_experience_admission_grants(user_id,origin_operation_id,registry_revision)
    select u,p_operation_id,policy.registry_revision + 1 from unnest(p_user_ids) u;
  insert into private.classroom_experience_admission_exclusions(user_id,origin_operation_id)
    select u,p_operation_id from unnest(p_excluded_user_ids) u;
  update private.classroom_experience_admission_policy set
    registry_revision = policy.registry_revision + 1,
    bootstrap_initialized = true,
    bootstrap_manifest_sha256 = case when p_kind = 'bootstrap' then p_manifest_sha256 else policy.bootstrap_manifest_sha256 end,
    growth_enabled = (result->>'growth_enabled')::boolean
  where singleton;
  return result;
end
$function$;

-- Unknown outcome reconciliation is read-only and does not create an operation.
create function public.read_classroom_experience_admission_operation_v2(p_operation_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $function$
  select b.result from private.classroom_experience_admission_batches b where b.operation_id = p_operation_id
$function$;

revoke all on function private.classroom_experience_admission_manifest_v2(text,uuid[],uuid[]),
  private.classroom_experience_admission_immutable_v2(),
  private.classroom_experience_admission_policy_guard_v2() from public, anon, authenticated, service_role;
revoke all on function public.read_classroom_experience_admission_v2(uuid),
  public.commit_classroom_experience_admission_batch_v2(uuid,bigint,text,uuid[],uuid[],text,text),
  public.read_classroom_experience_admission_operation_v2(uuid) from public, anon, authenticated, service_role;
grant execute on function public.read_classroom_experience_admission_v2(uuid),
  public.commit_classroom_experience_admission_batch_v2(uuid,bigint,text,uuid[],uuid[],text,text),
  public.read_classroom_experience_admission_operation_v2(uuid) to service_role;
commit;
