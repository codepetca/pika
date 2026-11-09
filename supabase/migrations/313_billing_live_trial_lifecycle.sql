-- Native cardless Pro trials on the attested live target. Paid Stripe and
-- sandbox RPCs retain their existing gates.
begin;

alter table private.stripe_billing_settings
  add column live_trial_lifecycle_enabled boolean not null default false,
  add column live_trial_admission_enabled boolean not null default false,
  add constraint stripe_billing_live_trial_controls check (
    (not live_trial_admission_enabled or live_trial_lifecycle_enabled)
    and (not live_trial_lifecycle_enabled or (
      live_project_ref is not null and live_stripe_account is not null
      and not sandbox_enabled and classroom_new_work_cutoff_enabled
    ))
  );

create table private.billing_live_trial_sources (
  subject_user_id uuid primary key references public.billing_trials(subject_user_id) on delete restrict,
  operation_id uuid not null unique references public.billing_trials(operation_id) on delete restrict,
  project_ref text not null check (project_ref ~ '^[a-z0-9]{20}$'),
  stripe_account text not null check (stripe_account ~ '^acct_[A-Za-z0-9]{1,255}$')
);
alter table private.billing_live_trial_sources enable row level security;
revoke all on private.billing_live_trial_sources from public,anon,authenticated,service_role;

-- First enable requires the previously pinned, clean target. Once a live trial
-- exists, keep the identity and classroom cutoff fixed even if the lifecycle
-- operator switch is turned off. Existing classes still observe the cutoff.
create function private.guard_billing_live_trial_controls_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if (old.live_project_ref is not null or new.live_project_ref is not null)
    and current_setting('transaction_isolation')<>'read committed' then
    raise exception using errcode='40001',message='billing_live_trial_requires_read_committed';
  end if;
  if exists(select 1 from private.billing_live_trial_sources) then
    if new.live_project_ref is distinct from old.live_project_ref
      or new.live_stripe_account is distinct from old.live_stripe_account
      or not new.classroom_new_work_cutoff_enabled then
      raise exception using errcode='55000',message='billing_live_trial_target_in_use';
    end if;
  elsif new.live_trial_lifecycle_enabled and (
    new.live_project_ref is distinct from old.live_project_ref
    or new.live_stripe_account is distinct from old.live_stripe_account
    or (not old.live_trial_lifecycle_enabled and not public.billing_attest_live_target_v1(
      new.live_project_ref,new.live_stripe_account))
  ) then
    raise exception using errcode='55000',message='billing_live_trial_target_not_attested';
  end if;
  return new;
end;
$$;

create trigger billing_live_trial_controls
  before update of live_project_ref,live_stripe_account,classroom_new_work_cutoff_enabled,live_trial_lifecycle_enabled
  on private.stripe_billing_settings for each row execute function private.guard_billing_live_trial_controls_v1();

create function public.billing_live_trial_lifecycle_ready_v1(p_project_ref text,p_stripe_account text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from private.stripe_billing_settings settings
    where settings.singleton and settings.live_trial_lifecycle_enabled
      and not settings.sandbox_enabled and settings.classroom_new_work_cutoff_enabled
      and settings.live_project_ref=p_project_ref and settings.live_stripe_account=p_stripe_account
  );
$$;

create function private.lock_billing_live_trial_settings_v1(p_project_ref text,p_stripe_account text)
returns private.stripe_billing_settings language plpgsql set search_path='' as $$
declare
  v_settings private.stripe_billing_settings%rowtype;
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception using errcode='40001',message='billing_live_trial_requires_read_committed';
  end if;
  select * into v_settings from private.stripe_billing_settings settings
    where settings.singleton and settings.live_trial_lifecycle_enabled
      and not settings.sandbox_enabled and settings.classroom_new_work_cutoff_enabled
      and settings.live_project_ref=p_project_ref and settings.live_stripe_account=p_stripe_account
    for share;
  if not found then
    raise exception using errcode='55000',message='billing_live_trial_lifecycle_unavailable';
  end if;
  return v_settings;
end;
$$;

create function private.billing_live_trial_source_matches_v1(
  p_subject uuid,p_project_ref text,p_stripe_account text
)
returns boolean language sql stable set search_path='' as $$
  select exists (
    select 1 from private.billing_live_trial_sources source
    join public.billing_trials trial on trial.subject_user_id=source.subject_user_id
      and trial.operation_id=source.operation_id
    where source.subject_user_id=p_subject and source.project_ref=p_project_ref
      and source.stripe_account=p_stripe_account and trial.definition_id='pro-trial-v1'
      and trial.converted_to_paid_at is null
  );
$$;

create function private.billing_has_legacy_future_assignment_v1(p_subject uuid)
returns boolean language sql stable set search_path='' as $$
  select exists (
    select 1 from public.classrooms classroom
    join public.assignments assignment on assignment.classroom_id=classroom.id
    where classroom.teacher_id=p_subject and not assignment.is_draft
      and assignment.released_at>statement_timestamp()
  );
$$;

-- Future timestamp publication, including native archive restore, and
-- classroom transfer both participate in the account lock used by admission.
-- The settings share lock also orders future writes against first activation.
create function private.guard_billing_live_trial_future_assignment_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_project text;
  v_owner uuid;
begin
  if new.is_draft or new.released_at is null or new.released_at<=clock_timestamp() then
    return new;
  end if;
  select live_project_ref into v_project from private.stripe_billing_settings where singleton for share;
  if v_project is null then return new; end if;
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception using errcode='40001',message='billing_live_trial_requires_read_committed';
  end if;
  begin
    select teacher_id into v_owner from public.classrooms where id=new.classroom_id for share nowait;
  exception when lock_not_available then
    raise exception using errcode='PT409',message='billing_assignment_publication_busy';
  end;
  if not found then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||v_owner::text,20620260924));
  if exists (
    select 1 from private.billing_live_trial_sources source
    join public.account_plans plan on plan.subject_user_id=source.subject_user_id
    where source.subject_user_id=v_owner and plan.management_source='trial'
  ) then
    raise exception using errcode='PT403',message='billing_classroom_new_work_unavailable';
  end if;
  return new;
end;
$$;

create trigger billing_assignment_live_trial_fence
  before insert or update of is_draft,released_at,classroom_id on public.assignments
  for each row execute function private.guard_billing_live_trial_future_assignment_v1();

create function private.guard_billing_live_trial_classroom_transfer_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_project text;
begin
  select live_project_ref into v_project from private.stripe_billing_settings where singleton for share;
  if v_project is null then return new; end if;
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception using errcode='40001',message='billing_live_trial_requires_read_committed';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||new.teacher_id::text,20620260924));
  if exists (
    select 1 from private.billing_live_trial_sources source
    join public.account_plans plan on plan.subject_user_id=source.subject_user_id
    where source.subject_user_id=new.teacher_id and plan.management_source='trial'
  ) and exists (
    select 1 from public.assignments
    where classroom_id=new.id and not is_draft and released_at>statement_timestamp()
  ) then
    raise exception using errcode='PT403',message='billing_classroom_new_work_unavailable';
  end if;
  return new;
end;
$$;

create trigger billing_live_trial_classroom_transfer_fence
  before update of teacher_id on public.classrooms
  for each row when (new.teacher_id is distinct from old.teacher_id)
  execute function private.guard_billing_live_trial_classroom_transfer_v1();

create function private.billing_live_trial_eligible_v1(p_subject uuid)
returns boolean language sql stable set search_path='' as $$
  select private.billing_trial_eligible_v1(p_subject)
    and exists (
      select 1 from public.account_plans plan
      join public.account_plan_audit plan_audit on plan_audit.subject_user_id=plan.subject_user_id
        and plan_audit.plan_revision=plan.revision and plan_audit.new_plan_key='free'
        and plan_audit.new_classroom_limit=0
      join public.effective_feature_entitlements entitlement on entitlement.subject_user_id=plan.subject_user_id
        and entitlement.feature_key='classrooms.create' and entitlement.source='plan'
        and not entitlement.enabled and entitlement.quota_limit=0 and entitlement.expires_at is null
        and entitlement.revision=plan_audit.entitlement_revision
      join public.effective_feature_entitlement_audit entitlement_audit
        on entitlement_audit.operation_id=plan_audit.operation_id
        and entitlement_audit.subject_user_id=entitlement.subject_user_id
        and entitlement_audit.feature_key=entitlement.feature_key
        and entitlement_audit.entitlement_revision=entitlement.revision
        and entitlement_audit.new_source=entitlement.source
        and entitlement_audit.new_enabled=entitlement.enabled
        and entitlement_audit.new_starts_at=entitlement.starts_at
        and entitlement_audit.new_expires_at is not distinct from entitlement.expires_at
        and entitlement_audit.new_quota_limit is not distinct from entitlement.quota_limit
      where plan.subject_user_id=p_subject and plan.management_source='legacy'
        and plan.plan_key='free' and plan.billing_offering_version_id is null
    )
    and not exists(select 1 from public.billing_account_access where subject_user_id=p_subject);
$$;

create function private.billing_live_trial_status_v1(
  p_subject uuid,p_settings private.stripe_billing_settings,p_include_options boolean
)
returns jsonb language plpgsql set search_path='' as $$
declare
  v_plan public.account_plans%rowtype;
  v_access public.billing_account_access%rowtype;
  v_entitlement public.effective_feature_entitlements%rowtype;
  v_trial public.billing_trials%rowtype;
  v_now timestamptz:=clock_timestamp();
  v_state text:='synchronization_pending';
  v_plan_key text:='free';
  v_limit integer:=0;
  v_ends_at timestamptz;
  v_can_start boolean:=false;
  v_revision bigint;
  v_options jsonb:='{}'::jsonb;
begin
  select * into v_plan from public.account_plans where subject_user_id=p_subject;
  if not found then raise exception using errcode='55000',message='billing_account_unavailable'; end if;
  select * into v_entitlement from public.effective_feature_entitlements
    where subject_user_id=p_subject and feature_key='classrooms.create';
  select * into v_access from public.billing_account_access where subject_user_id=p_subject;
  v_revision:=v_plan.revision;

  if v_plan.management_source='legacy' and v_access.subject_user_id is null then
    v_state:=case when v_plan.plan_key='free' then 'free' else 'unmanaged' end;
    v_plan_key:=v_plan.plan_key;
    v_limit:=coalesce(v_entitlement.quota_limit,0);
    v_ends_at:=v_entitlement.expires_at;
    v_can_start:=coalesce(v_entitlement.enabled and v_now>=v_entitlement.starts_at
      and (v_entitlement.expires_at is null or v_now<v_entitlement.expires_at) and v_limit>0,false);
  elsif v_plan.management_source='trial' and v_plan.billing_offering_version_id is null
    and v_access.source='trial' and v_access.trial_subject_user_id=p_subject
    and v_access.end_reason='trial' and v_access.account_plan_revision=v_plan.revision
    and v_access.entitlement_revision=v_entitlement.revision
    and private.billing_live_trial_source_matches_v1(p_subject,p_settings.live_project_ref,p_settings.live_stripe_account) then
    select * into strict v_trial from public.billing_trials where subject_user_id=p_subject;
    v_revision:=v_access.revision;
    v_ends_at:=v_access.access_ends_at;
    if v_trial.started_at=v_access.starts_at and v_trial.ends_at=v_access.access_ends_at then
      if v_now>=v_access.access_ends_at then
        v_state:='free';
      elsif v_plan.plan_key='plus' and v_access.expiry_applied_at is null
        and v_entitlement.enabled and v_entitlement.source='trial' and v_entitlement.quota_limit=5
        and v_entitlement.starts_at=v_access.starts_at and v_entitlement.expires_at=v_access.access_ends_at
        and v_now>=v_access.starts_at then
        v_state:='trial';
        v_plan_key:='plus';
        v_limit:=5;
        v_can_start:=true;
      end if;
    end if;
  end if;

  if p_include_options then
    v_options:=jsonb_build_object('customer_options',jsonb_build_object(
      'trial_available',p_settings.live_trial_admission_enabled
        and private.billing_live_trial_eligible_v1(p_subject)
        and not private.billing_has_legacy_future_assignment_v1(p_subject),
      'checkout_available',false,'has_billing_customer',false,'pending_checkout_id',null,'paid_terms',null));
  end if;
  return jsonb_build_object('subject_user_id',p_subject,'state',v_state,'plan_key',v_plan_key,
    'offering_version_id',null,'classroom_limit',v_limit,'access_ends_at',v_ends_at,'renewal_at',null,
    'can_start_paid_work',v_can_start,'retryable',v_state='synchronization_pending','revision',v_revision)||v_options;
end;
$$;

create function public.billing_get_live_access_status_v1(
  p_project_ref text,p_stripe_account text,p_payload jsonb
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_settings private.stripe_billing_settings%rowtype;
  v_subject uuid:=(p_payload->>'subject_user_id')::uuid;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' or v_subject is null
    or exists(select 1 from jsonb_object_keys(p_payload) as key(name)
      where key.name not in ('subject_user_id','include_options'))
    or (p_payload ? 'include_options' and jsonb_typeof(p_payload->'include_options') is distinct from 'boolean') then
    raise exception using errcode='22023',message='billing_live_trial_status_invalid';
  end if;
  v_settings:=private.lock_billing_live_trial_settings_v1(p_project_ref,p_stripe_account);
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||v_subject::text,20620260924));
  if not exists(select 1 from public.users where id=v_subject and role='teacher') then
    raise exception using errcode='55000',message='billing_account_unavailable';
  end if;
  perform public.lock_effective_feature_entitlement_v1(v_subject,'classrooms.create');
  return private.billing_live_trial_status_v1(v_subject,v_settings,p_payload->'include_options'='true'::jsonb);
end;
$$;

create function public.billing_start_live_trial_v1(
  p_project_ref text,p_stripe_account text,p_payload jsonb
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_settings private.stripe_billing_settings%rowtype;
  v_subject uuid:=(p_payload->>'subject_user_id')::uuid;
  v_operation uuid:=(p_payload->>'operation_id')::uuid;
  v_plan public.account_plans%rowtype;
  v_trial public.billing_trials%rowtype;
  v_now timestamptz;
  v_status jsonb;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' or v_subject is null or v_operation is null
    or exists(select 1 from jsonb_object_keys(p_payload) as key(name)
      where key.name not in ('subject_user_id','operation_id')) then
    raise exception using errcode='22023',message='billing_live_trial_start_invalid';
  end if;
  v_settings:=private.lock_billing_live_trial_settings_v1(p_project_ref,p_stripe_account);
  perform pg_advisory_xact_lock(hashtextextended('stripe-checkout-account:'||v_subject::text,21120260926));
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||v_subject::text,20620260924));
  if not exists(select 1 from public.users where id=v_subject and role='teacher') then
    raise exception using errcode='55000',message='billing_trial_ineligible';
  end if;
  select * into v_trial from public.billing_trials where subject_user_id=v_subject;
  if found then
    if v_trial.operation_id=v_operation
      and private.billing_live_trial_source_matches_v1(v_subject,p_project_ref,p_stripe_account) then
      perform public.lock_effective_feature_entitlement_v1(v_subject,'classrooms.create');
      return private.billing_live_trial_status_v1(v_subject,v_settings,false);
    end if;
    raise exception using errcode='55000',message='billing_trial_ineligible';
  end if;
  if not v_settings.live_trial_admission_enabled then
    raise exception using errcode='55000',message='billing_live_trial_admission_disabled';
  end if;
  select * into v_plan from public.account_plans where subject_user_id=v_subject for update;
  if not found then raise exception using errcode='55000',message='billing_trial_ineligible'; end if;
  perform public.lock_effective_feature_entitlement_v1(v_subject,'classrooms.create');
  if not private.billing_live_trial_eligible_v1(v_subject) then
    raise exception using errcode='55000',message='billing_trial_ineligible';
  end if;
  if private.billing_has_legacy_future_assignment_v1(v_subject) then
    raise exception using errcode='55000',message='billing_live_trial_future_releases';
  end if;
  v_now:=clock_timestamp();
  insert into public.billing_trials(subject_user_id,operation_id,definition_id,started_at,ends_at)
    values(v_subject,v_operation,'pro-trial-v1',v_now,v_now+interval '720 hours');
  insert into private.billing_live_trial_sources(subject_user_id,operation_id,project_ref,stripe_account)
    values(v_subject,v_operation,p_project_ref,p_stripe_account);
  insert into public.billing_account_access(subject_user_id,source,trial_subject_user_id,starts_at,access_ends_at,
    end_reason,account_plan_revision)
    values(v_subject,'trial',v_subject,v_now,v_now+interval '720 hours','trial',v_plan.revision);
  perform private.billing_write_access_v1(v_subject,v_plan.revision,'trial_started');
  v_status:=private.billing_live_trial_status_v1(v_subject,v_settings,false);
  insert into public.billing_lifecycle_audit(subject_user_id,operation_id,reason,next_state)
    values(v_subject,v_operation,'trial_started',v_status);
  return v_status;
end;
$$;

create function public.billing_apply_due_live_trial_access_v1(
  p_project_ref text,p_stripe_account text,p_payload jsonb
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_settings private.stripe_billing_settings%rowtype;
  v_subject uuid;
  v_access public.billing_account_access%rowtype;
  v_plan public.account_plans%rowtype;
  v_entitlement public.effective_feature_entitlements%rowtype;
  v_trial public.billing_trials%rowtype;
  v_limit integer:=(p_payload->>'limit')::integer;
  v_count integer:=0;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' or v_limit is null or v_limit not between 1 and 100
    or exists(select 1 from jsonb_object_keys(p_payload) as key(name) where key.name<>'limit') then
    raise exception using errcode='22023',message='billing_limit_invalid';
  end if;
  v_settings:=private.lock_billing_live_trial_settings_v1(p_project_ref,p_stripe_account);
  for v_subject in
    select access.subject_user_id from public.billing_account_access access
    join public.account_plans plan on plan.subject_user_id=access.subject_user_id
      and plan.revision=access.account_plan_revision and plan.management_source='trial' and plan.plan_key='plus'
      and plan.billing_offering_version_id is null
    join public.effective_feature_entitlements entitlement on entitlement.subject_user_id=access.subject_user_id
      and entitlement.feature_key='classrooms.create' and entitlement.revision=access.entitlement_revision
      and entitlement.starts_at=access.starts_at and entitlement.expires_at=access.access_ends_at
      and entitlement.source='trial' and entitlement.enabled and entitlement.quota_limit=5
    join public.billing_trials trial on trial.subject_user_id=access.subject_user_id
      and trial.started_at=access.starts_at and trial.ends_at=access.access_ends_at
    where access.source='trial' and access.trial_subject_user_id=access.subject_user_id
      and access.end_reason='trial' and access.expiry_applied_at is null
      and access.access_ends_at<=statement_timestamp()
      and private.billing_live_trial_source_matches_v1(access.subject_user_id,p_project_ref,p_stripe_account)
    order by access.access_ends_at,access.subject_user_id limit v_limit
  loop
    if not pg_try_advisory_xact_lock(hashtextextended('account-plan-subject:'||v_subject::text,20620260924)) then
      continue;
    end if;
    select * into v_plan from public.account_plans where subject_user_id=v_subject for update;
    select * into v_access from public.billing_account_access where subject_user_id=v_subject for update;
    if not found or v_plan.management_source is distinct from 'trial' or v_plan.plan_key is distinct from 'plus'
      or v_plan.billing_offering_version_id is not null
      or v_access.account_plan_revision is distinct from v_plan.revision or v_access.source is distinct from 'trial'
      or v_access.trial_subject_user_id is distinct from v_subject or v_access.end_reason is distinct from 'trial'
      or v_access.expiry_applied_at is not null or v_access.access_ends_at>clock_timestamp()
      or not private.billing_live_trial_source_matches_v1(v_subject,p_project_ref,p_stripe_account) then
      continue;
    end if;
    perform public.lock_effective_feature_entitlement_v1(v_subject,'classrooms.create');
    select * into v_entitlement from public.effective_feature_entitlements
      where subject_user_id=v_subject and feature_key='classrooms.create';
    select * into v_trial from public.billing_trials where subject_user_id=v_subject;
    if v_entitlement.revision is null or v_entitlement.revision is distinct from v_access.entitlement_revision
      or v_entitlement.starts_at is distinct from v_access.starts_at
      or v_entitlement.expires_at is distinct from v_access.access_ends_at
      or v_entitlement.source is distinct from 'trial' or not v_entitlement.enabled or v_entitlement.quota_limit<>5
      or v_trial.started_at is distinct from v_access.starts_at
      or v_trial.ends_at is distinct from v_access.access_ends_at then
      continue;
    end if;
    perform private.billing_write_access_v1(v_subject,v_plan.revision,'subscription_expired');
    insert into public.billing_lifecycle_audit(subject_user_id,operation_id,reason,next_state)
      values(v_subject,gen_random_uuid(),'subscription_expired',private.billing_live_trial_status_v1(v_subject,v_settings,false));
    v_count:=v_count+1;
  end loop;
  return jsonb_build_object('processed',v_count);
end;
$$;

-- Preserve the existing resolver and all nontrial grant paths.
create or replace function public.get_repolight_analysis_access_v1(p_subject_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  settings private.repolight_settings;
  plan public.account_plans;
  entitlement public.effective_feature_entitlements;
  access public.billing_account_access;
  trial public.billing_trials;
  definition public.billing_trial_definitions;
  binding public.stripe_billing_subscription_bindings;
  version public.stripe_billing_offering_versions;
  offering_plan text;
  now_at timestamptz;
  decision text := 'account_unavailable';
  source_kind text;
  ends_at timestamptz;
begin
  perform private.lock_repolight_analysis_access_v1(p_subject_user_id);
  select * into settings from private.repolight_settings where singleton;
  select * into plan from public.account_plans where subject_user_id=p_subject_user_id;
  select * into entitlement from public.effective_feature_entitlements
    where subject_user_id=p_subject_user_id and feature_key='classrooms.create';
  select * into access from public.billing_account_access where subject_user_id=p_subject_user_id;
  source_kind := case plan.management_source when 'legacy' then 'legacy' when 'trial' then 'trial' when 'billing' then 'offering' end;
  ends_at := case when plan.management_source='legacy' then entitlement.expires_at else access.access_ends_at end;
  -- Read time only after waiting for the authoritative writers. No client clock
  -- and no expiry job are necessary to stop new work at the exclusive deadline.
  now_at := clock_timestamp();
  if settings.singleton is null then decision := 'access_unavailable';
  elsif plan.subject_user_id is null then null;
  elsif plan.plan_key not in ('plus','pro') then decision := 'plan_not_included';
  elsif entitlement.subject_user_id is null or not entitlement.enabled then decision := 'entitlement_inconsistent';
  elsif now_at < entitlement.starts_at then decision := 'not_started';
  elsif plan.management_source='legacy' and entitlement.expires_at is not null and now_at >= entitlement.expires_at then decision := 'expired';
  elsif plan.management_source='legacy' then
    source_kind := 'legacy'; ends_at := entitlement.expires_at;
    if not settings.legacy_plan_access_enabled then decision := 'legacy_access_disabled';
    elsif entitlement.source <> 'plan' or plan.billing_offering_version_id is not null
      or access.subject_user_id is not null
      or not exists(select 1 from public.account_plan_audit audit
        where audit.subject_user_id=p_subject_user_id and audit.plan_revision=plan.revision
          and audit.new_plan_key=plan.plan_key and audit.entitlement_revision=entitlement.revision
          and audit.new_classroom_limit=entitlement.quota_limit)
      then decision := 'entitlement_inconsistent';
    else decision := 'eligible'; end if;
  elsif plan.management_source in ('billing','trial') then
    source_kind := case when plan.management_source='trial' then 'trial' else 'offering' end;
    ends_at := access.access_ends_at;
    -- The live exception applies only to trials recorded for this exact target.
    -- Purchased Stripe offerings still require the sandbox lane.
    if not settings.billing_access_enabled or not exists (
      select 1 from private.stripe_billing_settings billing where billing.singleton
      and ((billing.sandbox_enabled and billing.provider_mode='test') or (
        plan.management_source='trial' and billing.live_trial_lifecycle_enabled
        and not billing.sandbox_enabled and billing.classroom_new_work_cutoff_enabled
        and private.billing_live_trial_source_matches_v1(p_subject_user_id,billing.live_project_ref,billing.live_stripe_account)
      ))
    ) then decision := 'billing_access_disabled';
    elsif access.subject_user_id is null or access.account_plan_revision <> plan.revision
      or access.entitlement_revision is distinct from entitlement.revision
      or entitlement.starts_at is distinct from access.starts_at
      or entitlement.expires_at is distinct from access.access_ends_at
      then decision := 'entitlement_inconsistent';
    elsif now_at < access.starts_at then decision := 'not_started';
    elsif now_at >= access.access_ends_at then
      decision := case when access.end_reason='renewal_pending' then 'synchronization_pending' else 'expired' end;
    elsif plan.management_source='trial' then
      select * into trial from public.billing_trials where subject_user_id=p_subject_user_id;
      select * into definition from public.billing_trial_definitions where id=trial.definition_id;
      if access.source <> 'trial' or entitlement.source <> 'trial' or plan.plan_key <> 'plus'
        or plan.billing_offering_version_id is not null or access.offering_version_id is not null
        or trial.subject_user_id is null or trial.converted_to_paid_at is not null
        or definition.plan_key is distinct from 'plus' or definition.classroom_limit is distinct from entitlement.quota_limit
        or trial.started_at is distinct from access.starts_at or trial.ends_at is distinct from access.access_ends_at
        or access.trial_subject_user_id is distinct from p_subject_user_id
        then decision := 'entitlement_inconsistent';
      else decision := 'eligible'; end if;
    else
      select * into binding from public.stripe_billing_subscription_bindings where id=access.subscription_id;
      select * into version from public.stripe_billing_offering_versions where id=access.offering_version_id;
      select plan_key into offering_plan from public.stripe_billing_offerings where id=version.offering_id;
      if access.source <> 'paid' or entitlement.source <> 'plan'
        or binding.id is null or not binding.is_current or binding.subject_user_id is distinct from p_subject_user_id
        or binding.offering_version_id is distinct from access.offering_version_id
        or plan.billing_offering_version_id is distinct from access.offering_version_id
        or version.id is null or offering_plan is distinct from plan.plan_key
        or version.classroom_limit is distinct from entitlement.quota_limit
        or version.provider_mode <> 'test' or binding.provider_mode <> 'test'
        or binding.stripe_account is distinct from version.stripe_account
        or not exists(
          -- A verified prorated upgrade preserves the original paid invoice and
          -- writes an immutable transition receipt. Follow that exact period's
          -- receipt chain; a current tier label cannot substitute for evidence.
          with recursive paid_versions(offering_version_id,revision,depth) as (
            select effect.offering_version_id,effect.account_plan_revision,0
            from public.stripe_billing_invoice_effects effect
            where effect.subscription_id=binding.id and effect.stripe_account=version.stripe_account
              and effect.stripe_invoice_id=access.last_paid_invoice_id
              and effect.period_start=access.paid_period_start and effect.period_end=access.paid_through
              and effect.account_plan_revision<=plan.revision
            union all
            select receipt.target_offering_version_id,receipt.account_plan_revision,prior.depth+1
            from paid_versions prior join public.billing_upgrade_receipts receipt
              on receipt.source_offering_version_id=prior.offering_version_id
            where receipt.subscription_id=binding.id and receipt.stripe_account=version.stripe_account
              and receipt.paid_period_start=access.paid_period_start and receipt.paid_through=access.paid_through
              and receipt.account_plan_revision>prior.revision and receipt.account_plan_revision<=plan.revision
              and prior.depth<16
          ) select 1 from paid_versions where offering_version_id=version.id)
        then decision := 'entitlement_inconsistent';
      else decision := 'eligible'; end if;
    end if;
  else decision := 'entitlement_inconsistent';
  end if;
  return jsonb_build_object('enforced',coalesce(settings.plan_enforcement_enabled,true),'allowed',decision='eligible',
    'reason',decision,'source',source_kind,'access_ends_at',ends_at,'plan_revision',plan.revision);
end $$;

create or replace function private.repolight_provision_gate_hint_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if jsonb_build_array(to_jsonb(new)->'managed_provisioning_enabled',to_jsonb(new)->'billing_access_enabled',to_jsonb(new)->'legacy_plan_access_enabled',
  to_jsonb(new)->'sandbox_enabled',to_jsonb(new)->'provider_mode',to_jsonb(new)->'live_trial_lifecycle_enabled',
  to_jsonb(new)->'live_project_ref',to_jsonb(new)->'live_stripe_account') is distinct from
 jsonb_build_array(to_jsonb(old)->'managed_provisioning_enabled',to_jsonb(old)->'billing_access_enabled',to_jsonb(old)->'legacy_plan_access_enabled',
  to_jsonb(old)->'sandbox_enabled',to_jsonb(old)->'provider_mode',to_jsonb(old)->'live_trial_lifecycle_enabled',
  to_jsonb(old)->'live_project_ref',to_jsonb(old)->'live_stripe_account') then
  update private.repolight_provision_control set epoch=epoch+1 where singleton;
 end if;
 return new;
end $$;
revoke all on function private.repolight_provision_gate_hint_v1() from public,anon,authenticated,service_role;
drop trigger repolight_provision_billing_gate_hint on private.stripe_billing_settings;
create trigger repolight_provision_billing_gate_hint
  after update of sandbox_enabled,provider_mode,live_trial_lifecycle_enabled,live_project_ref,live_stripe_account
  on private.stripe_billing_settings for each row execute function private.repolight_provision_gate_hint_v1();

revoke all on function private.guard_billing_live_trial_controls_v1(),
  private.lock_billing_live_trial_settings_v1(text,text),
  private.billing_live_trial_source_matches_v1(uuid,text,text),
  private.billing_has_legacy_future_assignment_v1(uuid),
  private.guard_billing_live_trial_future_assignment_v1(),
  private.guard_billing_live_trial_classroom_transfer_v1(),
  private.billing_live_trial_eligible_v1(uuid),
  private.billing_live_trial_status_v1(uuid,private.stripe_billing_settings,boolean)
  from public,anon,authenticated,service_role;
revoke all on function public.billing_live_trial_lifecycle_ready_v1(text,text),
  public.billing_get_live_access_status_v1(text,text,jsonb),
  public.billing_start_live_trial_v1(text,text,jsonb),
  public.billing_apply_due_live_trial_access_v1(text,text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.billing_live_trial_lifecycle_ready_v1(text,text),
  public.billing_get_live_access_status_v1(text,text,jsonb),
  public.billing_start_live_trial_v1(text,text,jsonb),
  public.billing_apply_due_live_trial_access_v1(text,text,jsonb) to service_role;

commit;
