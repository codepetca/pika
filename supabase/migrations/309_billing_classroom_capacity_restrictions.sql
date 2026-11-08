-- Preserve classrooms and existing work when the billing entitlement shrinks.
-- Subscription restrictions are independent of ordinary archival and purge.
begin;

alter table private.billing_scheduled_plan_changes add column kept_classroom_ids uuid[];

create table private.billing_classroom_restrictions (
  subject_user_id uuid not null,
  classroom_id uuid not null,
  plan_revision bigint not null check (plan_revision>0),
  restricted_at timestamptz not null,
  restored_at timestamptz check (restored_at>=restricted_at),
  primary key(subject_user_id,classroom_id,plan_revision)
);

-- Billing holds the subject lock. A classroom FK would take a row lock in
-- the opposite order from Test Start. Readers always verify current ownership.
create unique index billing_classroom_restrictions_active
  on private.billing_classroom_restrictions(subject_user_id,classroom_id) where restored_at is null;
alter table private.billing_classroom_restrictions enable row level security;
revoke all on table private.billing_classroom_restrictions from public,anon,authenticated,service_role;

create function private.billing_classroom_is_restricted_v1(p_subject uuid,p_classroom uuid)
returns boolean language sql stable set search_path='' as $$
  select exists(select 1 from private.billing_classroom_restrictions restriction
    where restriction.subject_user_id=p_subject and restriction.classroom_id=p_classroom
      and restriction.restored_at is null);
$$;

create function private.billing_active_classroom_count_v1(p_subject uuid,p_exclude uuid,p_at timestamptz)
returns integer language sql stable set search_path='' as $$
  select count(*)::integer from public.classrooms classroom
  where classroom.teacher_id=p_subject and classroom.archived_at is null
    and (p_exclude is null or classroom.id<>p_exclude)
    and (not exists(select 1 from private.stripe_billing_settings where singleton and classroom_new_work_cutoff_enabled)
      or (not private.billing_classroom_is_restricted_v1(p_subject,classroom.id)
        and not exists(select 1 from public.account_plans plan
          left join public.billing_account_access access on access.subject_user_id=plan.subject_user_id
          where plan.subject_user_id=p_subject and plan.management_source<>'legacy'
            and (plan.plan_key='free' or access.subject_user_id is null
              or p_at<access.starts_at or p_at>=access.access_ends_at))));
$$;

create function private.billing_classroom_last_activity_v1(p_classroom uuid,p_at timestamptz)
returns timestamptz language sql stable set search_path='' as $$
  select greatest(
    (select max(coalesce(assignment.released_at,assignment.created_at)) from public.assignments assignment
      where assignment.classroom_id=p_classroom and not assignment.is_draft
        and coalesce(assignment.released_at,assignment.created_at)<=p_at),
    (select max(doc.submitted_at) from public.assignment_docs doc join public.assignments assignment on assignment.id=doc.assignment_id
      where assignment.classroom_id=p_classroom and doc.submitted_at<=p_at),
    (select max(attempt.created_at) from public.test_attempts attempt join public.tests test on test.id=attempt.test_id
      where test.classroom_id=p_classroom and attempt.created_at<=p_at),
    (select max(attempt.submitted_at) from public.test_attempts attempt join public.tests test on test.id=attempt.test_id
      where test.classroom_id=p_classroom and attempt.submitted_at<=p_at));
$$;

create function private.restrict_billing_classrooms_v1(
  p_subject uuid,p_revision bigint,p_at timestamptz,p_limit integer,p_keep uuid[]
)
returns void language plpgsql set search_path='' as $$
declare
  v_keep uuid[]:=p_keep;
begin
  if p_limit=0 then
    v_keep:='{}'::uuid[];
  elsif v_keep is null then
    select coalesce(array_agg(ranked.id),'{}'::uuid[]) into v_keep from (
      select classroom.id from public.classrooms classroom
      where classroom.teacher_id=p_subject and classroom.archived_at is null
        and not private.billing_classroom_is_restricted_v1(p_subject,classroom.id)
      order by private.billing_classroom_last_activity_v1(classroom.id,p_at) desc nulls last,
        classroom.created_at desc,classroom.id
      limit p_limit
    ) ranked;
  end if;

  insert into private.billing_classroom_restrictions(subject_user_id,classroom_id,plan_revision,restricted_at)
  select p_subject,classroom.id,p_revision,p_at from public.classrooms classroom
  where classroom.teacher_id=p_subject and classroom.archived_at is null
    and not private.billing_classroom_is_restricted_v1(p_subject,classroom.id)
    and not (classroom.id=any(v_keep));
end;
$$;

create function private.apply_billing_classroom_capacity_drop_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_previous_limit integer;
  v_scheduled_source_limit integer;
  v_keep uuid[];
  v_access_end timestamptz;
  v_end_reason text;
begin
  if new.actor_ref<>'stripe:billing' or not exists(select 1 from private.stripe_billing_settings
    where singleton and classroom_new_work_cutoff_enabled) then return new; end if;

  select audit.new_classroom_limit into v_previous_limit from public.account_plan_audit audit
    where audit.subject_user_id=new.subject_user_id and audit.plan_revision=new.plan_revision-1;
  if v_previous_limit is null or new.new_classroom_limit=v_previous_limit then return new; end if;

  select access.access_ends_at,access.end_reason,change.kept_classroom_ids,source.classroom_limit
    into strict v_access_end,v_end_reason,v_keep,v_scheduled_source_limit
  from public.billing_account_access access
  left join private.billing_scheduled_plan_changes change on change.subject_user_id=access.subject_user_id
    and change.subscription_id=access.subscription_id and change.state='scheduled'
    and change.target_offering_version_id=access.offering_version_id and change.effective_at=access.paid_period_start
  left join public.stripe_billing_offering_versions source on source.id=change.source_offering_version_id
  where access.subject_user_id=new.subject_user_id;

  -- Free already blocks new work at grace expiry. Persist restrictions once
  -- closeout verifies the unpaid result. If payment won, apply the downgrade
  -- against the last paid capacity and the original selection in this transaction.
  if new.new_classroom_limit=0 and v_end_reason='renewal_grace' then return new; end if;
  if v_previous_limit=0 and v_scheduled_source_limit is not null then v_previous_limit:=v_scheduled_source_limit; end if;
  if new.new_classroom_limit<v_previous_limit then
    perform private.restrict_billing_classrooms_v1(new.subject_user_id,new.plan_revision,
      case when new.new_classroom_limit=0 then least(v_access_end,new.created_at) else new.created_at end,
      new.new_classroom_limit,v_keep);
  end if;
  return new;
end;
$$;

-- The billing access writer already holds the subject and feature locks when
-- it records this revision. No classroom or learner rows are changed here.
create trigger billing_classroom_capacity_drop after insert on public.account_plan_audit
for each row execute function private.apply_billing_classroom_capacity_drop_v1();

create function private.apply_billing_classroom_unpaid_closeout_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_subject uuid;
begin
  if not exists(select 1 from private.stripe_billing_settings where singleton and classroom_new_work_cutoff_enabled) then
    return new;
  end if;
  select binding.subject_user_id into strict v_subject from public.stripe_billing_subscription_bindings binding
  where binding.id=new.subscription_id;
  perform private.restrict_billing_classrooms_v1(v_subject,new.expected_account_plan_revision,new.cutoff,0,null);
  return new;
end;
$$;

create trigger billing_classroom_unpaid_closeout after update of status on public.billing_renewal_closeouts
for each row when (new.status='closed' and old.status is distinct from new.status)
execute function private.apply_billing_classroom_unpaid_closeout_v1();

create function private.apply_billing_classroom_paid_reentry_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_previous_cutoff timestamptz:=(new.previous_state->>'access_ends_at')::timestamptz;
begin
  if v_previous_cutoff<=new.created_at
    and (new.previous_state->>'source'='trial'
      or (new.previous_state->>'source'='paid'
        and new.previous_state->>'subscription_id' is distinct from new.next_state->>'subscription_id'))
    and exists(select 1 from private.stripe_billing_settings where singleton and classroom_new_work_cutoff_enabled) then
    -- The lifecycle audit retains the prior access row after settlement replaces
    -- it. Expiry still applies when a new payer arrives ahead of the expiry job.
    perform private.restrict_billing_classrooms_v1(new.subject_user_id,
      (new.next_state->>'account_plan_revision')::bigint,v_previous_cutoff,0,null);
  end if;
  return new;
end;
$$;

create trigger billing_classroom_paid_reentry after insert on public.billing_lifecycle_audit
for each row when (new.reason='paid' and new.previous_state is not null)
execute function private.apply_billing_classroom_paid_reentry_v1();

create function private.apply_billing_classroom_unpaid_retirement_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_access public.billing_account_access%rowtype;
begin
  if not exists(select 1 from private.stripe_billing_settings where singleton and classroom_new_work_cutoff_enabled) then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||new.subject_user_id::text,20620260924));
  perform public.lock_effective_feature_entitlement_v1(new.subject_user_id,'classrooms.create');
  select * into v_access from public.billing_account_access
    where subject_user_id=new.subject_user_id and subscription_id=new.id and end_reason='renewal_grace';
  if found and v_access.access_ends_at<=clock_timestamp() then
    -- Ordinary reconciliation can independently verify terminal closure before
    -- closeout claims a lease. Record the same restriction at that boundary.
    perform private.restrict_billing_classrooms_v1(new.subject_user_id,
      v_access.account_plan_revision,v_access.access_ends_at,0,null);
  end if;
  return new;
end;
$$;

create trigger billing_classroom_unpaid_retirement after update of is_current on public.stripe_billing_subscription_bindings
for each row when (old.is_current and not new.is_current
  and new.terminal_confirmed_at is not null and new.obligations_cleared_at is not null)
execute function private.apply_billing_classroom_unpaid_retirement_v1();

create function public.set_billing_classroom_selection_v1(p_subject uuid,p_operation uuid,p_keep uuid[])
returns void language plpgsql security definer set search_path='' as $$
declare
  v_change private.billing_scheduled_plan_changes%rowtype;
  v_limit integer;
begin
  if not exists(select 1 from private.stripe_billing_settings where singleton and classroom_new_work_cutoff_enabled) then
    raise exception using errcode='PT503',message='billing_classroom_restrictions_disabled';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||p_subject::text,20620260924));
  select * into v_change from private.billing_scheduled_plan_changes
    where id=p_operation and subject_user_id=p_subject for update;
  if not found then raise exception using errcode='PT404',message='billing_classroom_change_not_found'; end if;
  if v_change.state not in ('quoted','confirmed','scheduled') or clock_timestamp()>=v_change.effective_at then
    raise exception using errcode='PT409',message='billing_classroom_selection_closed';
  end if;
  select classroom_limit into strict v_limit from public.stripe_billing_offering_versions
    where id=v_change.target_offering_version_id;
  if cardinality(p_keep)>v_limit or array_ndims(p_keep)>1 or (
    select count(distinct classroom.id) from unnest(p_keep) chosen(id)
      join public.classrooms classroom on classroom.id=chosen.id and classroom.teacher_id=p_subject
      where classroom.archived_at is null and not private.billing_classroom_is_restricted_v1(p_subject,classroom.id)
  )<>cardinality(p_keep) then
    raise exception using errcode='PT400',message='billing_classroom_selection_invalid';
  end if;
  update private.billing_scheduled_plan_changes set kept_classroom_ids=p_keep where id=p_operation;
end;
$$;

create function public.restore_billing_classroom_v1(p_subject uuid,p_classroom uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from private.stripe_billing_settings where singleton and classroom_new_work_cutoff_enabled) then
    raise exception using errcode='PT503',message='billing_classroom_restrictions_disabled';
  end if;
  perform 1 from public.classrooms where id=p_classroom and teacher_id=p_subject and archived_at is null for update nowait;
  if not found then raise exception using errcode='PT404',message='billing_classroom_not_found'; end if;
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||p_subject::text,20620260924));
  if not private.billing_classroom_is_restricted_v1(p_subject,p_classroom) then return false; end if;
  perform public.assert_classroom_creation_allowed_v1(p_subject,p_classroom,clock_timestamp());
  update private.billing_classroom_restrictions set restored_at=clock_timestamp()
  where subject_user_id=p_subject and classroom_id=p_classroom and restored_at is null;
  if not private.billing_classroom_can_start_work_v1(p_classroom) then
    raise exception using errcode='PT403',message='billing_classroom_new_work_unavailable';
  end if;
  return true;
end;
$$;

revoke all on function private.billing_classroom_is_restricted_v1(uuid,uuid),
  private.billing_active_classroom_count_v1(uuid,uuid,timestamptz),private.billing_classroom_last_activity_v1(uuid,timestamptz),
  private.restrict_billing_classrooms_v1(uuid,bigint,timestamptz,integer,uuid[]),
  private.apply_billing_classroom_capacity_drop_v1(),private.apply_billing_classroom_unpaid_closeout_v1(),
  private.apply_billing_classroom_paid_reentry_v1(),private.apply_billing_classroom_unpaid_retirement_v1()
  from public,anon,authenticated,service_role;
revoke all on function public.set_billing_classroom_selection_v1(uuid,uuid,uuid[]),
  public.restore_billing_classroom_v1(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.set_billing_classroom_selection_v1(uuid,uuid,uuid[]),
  public.restore_billing_classroom_v1(uuid,uuid) to service_role;

-- Keep the established creation and restore authorization contracts.
create or replace function public.get_classroom_creation_access_v1(
  p_subject_user_id uuid,
  p_at timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_entitlement public.effective_feature_entitlements%rowtype;
  v_active_count integer;
  v_strict_enforcement_enabled boolean;
  v_allowed boolean;
  v_reason text;
begin
  if p_subject_user_id is null or p_at is null then
    raise exception using
      errcode = '22023',
      message = 'classroom_creation_access_request_invalid';
  end if;

  select * into v_entitlement
  from public.effective_feature_entitlements
  where subject_user_id = p_subject_user_id
    and feature_key = 'classrooms.create';

  select coalesce(settings.strict_enforcement_enabled, true)
  into v_strict_enforcement_enabled
  from private.classroom_creation_entitlement_settings settings
  where singleton;

  -- A missing or unreadable singleton is configuration corruption and must not
  -- reopen legacy creation.
  v_strict_enforcement_enabled := coalesce(v_strict_enforcement_enabled, true);

  v_active_count := private.billing_active_classroom_count_v1(p_subject_user_id, null, p_at);

  if v_entitlement.subject_user_id is null then
    if v_strict_enforcement_enabled or exists (
      select 1
      from public.effective_feature_entitlement_audit
      where subject_user_id = p_subject_user_id
        and feature_key = 'classrooms.create'
    ) then
      v_allowed := false;
      v_reason := 'unavailable';
    else
      v_allowed := true;
      v_reason := 'legacy';
    end if;
  elsif not v_entitlement.enabled then
    v_allowed := false;
    v_reason := 'disabled';
  elsif p_at < v_entitlement.starts_at then
    v_allowed := false;
    v_reason := 'not_started';
  elsif v_entitlement.expires_at is not null
    and p_at >= v_entitlement.expires_at
  then
    v_allowed := false;
    v_reason := 'expired';
  elsif v_entitlement.quota_limit is not null
    and v_active_count >= v_entitlement.quota_limit
  then
    v_allowed := false;
    v_reason := 'active_limit_reached';
  else
    v_allowed := true;
    v_reason := 'allowed';
  end if;

  return jsonb_build_object(
    'subject_user_id', p_subject_user_id,
    'feature_key', 'classrooms.create',
    'managed', v_entitlement.subject_user_id is not null,
    'allowed', v_allowed,
    'reason', v_reason,
    'source', v_entitlement.source,
    'starts_at', v_entitlement.starts_at,
    'expires_at', v_entitlement.expires_at,
    'quota_limit', v_entitlement.quota_limit,
    'active_count', v_active_count,
    'revision', v_entitlement.revision
  );
end;
$$;

create or replace function public.assert_classroom_creation_allowed_v1(
  p_subject_user_id uuid,
  p_exclude_classroom_id uuid default null,
  p_at timestamptz default clock_timestamp()
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_entitlement public.effective_feature_entitlements%rowtype;
  v_active_count integer;
  v_strict_enforcement_enabled boolean;
begin
  if p_subject_user_id is null or p_at is null then
    raise exception using
      errcode = '22023',
      message = 'classroom_creation_access_request_invalid';
  end if;

  -- Keep the established subject-first lock order used by ordinary and
  -- Blueprint creation, then hold the shared cutover lock through the caller's
  -- transaction. A classroom admitted under legacy compatibility must finish
  -- before activation commits.
  perform public.lock_effective_feature_entitlement_v1(
    p_subject_user_id,
    'classrooms.create'
  );

  select settings.strict_enforcement_enabled
  into v_strict_enforcement_enabled
  from private.classroom_creation_entitlement_settings settings
  where singleton
  for share;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'classroom_creation_entitlement_unavailable';
  end if;

  select * into v_entitlement
  from public.effective_feature_entitlements
  where subject_user_id = p_subject_user_id
    and feature_key = 'classrooms.create';

  if v_entitlement.subject_user_id is null then
    if v_strict_enforcement_enabled or exists (
      select 1
      from public.effective_feature_entitlement_audit
      where subject_user_id = p_subject_user_id
        and feature_key = 'classrooms.create'
    ) then
      raise exception using
        errcode = '55000',
        message = 'classroom_creation_entitlement_unavailable';
    end if;
    return;
  end if;

  if not v_entitlement.enabled then
    raise exception using
      errcode = '42501',
      message = 'classroom_creation_entitlement_disabled';
  end if;

  if p_at < v_entitlement.starts_at then
    raise exception using
      errcode = '42501',
      message = 'classroom_creation_entitlement_not_started';
  end if;

  if v_entitlement.expires_at is not null
    and p_at >= v_entitlement.expires_at
  then
    raise exception using
      errcode = '42501',
      message = 'classroom_creation_entitlement_expired';
  end if;

  if v_entitlement.quota_limit is null then
    return;
  end if;

  v_active_count := private.billing_active_classroom_count_v1(p_subject_user_id, p_exclude_classroom_id, p_at);

  if v_active_count >= v_entitlement.quota_limit then
    raise exception using
      errcode = '23514',
      message = 'classroom_creation_active_limit_reached';
  end if;
end;
$$;

create or replace function private.billing_classroom_can_start_work_v1(p_classroom_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare
  v_owner uuid;
  v_plan public.account_plans%rowtype;
  v_access public.billing_account_access%rowtype;
  v_entitlement public.effective_feature_entitlements%rowtype;
  v_now timestamptz;
begin
  if not exists(select 1 from private.stripe_billing_settings where singleton and classroom_new_work_cutoff_enabled) then
    return true;
  end if;
  -- The caller has already bound the resource and locked its classroom.
  select teacher_id into v_owner from public.classrooms where id=p_classroom_id;
  if not found then return false; end if;
  -- The billing writer takes this same lock before changing plan and access.
  -- It does not take classroom locks. Read time after all entitlement waits.
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||v_owner::text,20620260924));
  if private.billing_classroom_is_restricted_v1(v_owner,p_classroom_id) then return false; end if;
  select * into v_plan from public.account_plans where subject_user_id=v_owner;
  if v_plan.management_source='legacy' then return true; end if;
  select * into v_access from public.billing_account_access where subject_user_id=v_owner;
  if v_plan.subject_user_id is null then return v_access.subject_user_id is null; end if;
  perform public.lock_effective_feature_entitlement_v1(v_owner,'classrooms.create');
  select * into v_entitlement from public.effective_feature_entitlements
    where subject_user_id=v_owner and feature_key='classrooms.create';
  v_now:=clock_timestamp();
  return coalesce(
    v_plan.plan_key<>'free'
    and v_access.account_plan_revision=v_plan.revision
    and v_access.entitlement_revision=v_entitlement.revision
    and v_access.expiry_applied_at is null
    and v_entitlement.enabled and v_entitlement.quota_limit>0
    and v_entitlement.starts_at=v_access.starts_at and v_entitlement.expires_at=v_access.access_ends_at
    and v_now>=v_access.starts_at and v_now<v_access.access_ends_at
    and (
      (v_plan.management_source='trial' and v_access.source='trial' and v_entitlement.source='trial'
        and v_access.trial_subject_user_id=v_owner)
      or (v_plan.management_source='billing' and v_access.source='paid' and v_entitlement.source='plan'
        and v_plan.billing_offering_version_id=v_access.offering_version_id
        and exists(select 1 from public.stripe_billing_subscription_bindings binding
          where binding.id=v_access.subscription_id and binding.subject_user_id=v_owner and binding.is_current
            and binding.offering_version_id=v_access.offering_version_id))
    ),false);
end;
$$;

commit;
