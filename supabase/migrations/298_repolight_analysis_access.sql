-- Source-only RepoLight entitlement boundary. No plan assignments, backfill,
-- provider configuration, billing activation or rollout changes.
begin;

alter table private.repolight_settings
  add column plan_enforcement_enabled boolean not null default false,
  add column legacy_plan_access_enabled boolean not null default false,
  add column billing_access_enabled boolean not null default false;

-- Global order: billing settings -> RepoLight settings -> account plan advisory
-- fence -> feature advisory fence -> assignment/classroom/membership locks.
-- Account writers use this exact account fence; direct entitlement writers use
-- the feature fence. Do not lock a billing subscription first from this path:
-- billing writers already acquire subscription -> account plan.
create function private.lock_repolight_analysis_access_v1(p_subject uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare enforced boolean;
begin
  -- Billing writers acquire this row before the account fence. Hold its share
  -- lock through admission so a concurrent sandbox disable cannot commit after
  -- we read enabled=true but before this transaction authorizes new work.
  perform 1 from private.stripe_billing_settings where singleton for share;
  select plan_enforcement_enabled into enforced
    from private.repolight_settings where singleton for share;
  if not found then enforced := true; end if;
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||p_subject::text,20620260924));
  perform public.lock_effective_feature_entitlement_v1(p_subject,'classrooms.create');
  return enforced;
end $$;

-- This resolver is independent of the billing sandbox-only access RPC and its
-- permissive unmanaged fallback. "allowed" always means actual eligibility;
-- dormant enforcement never turns missing facts into an entitlement.
create function public.get_repolight_analysis_access_v1(p_subject_user_id uuid)
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
    -- Current billing is test-only. This flag does not promote the billing
    -- foundation to live mode or allow stale sandbox fixtures when it is off.
    if not settings.billing_access_enabled or not exists(select 1 from private.stripe_billing_settings
      where singleton and sandbox_enabled and provider_mode='test') then decision := 'billing_access_disabled';
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
      elsif version.features->'repolight_analysis' is distinct from 'true'::jsonb then decision := 'offering_not_included';
      else decision := 'eligible'; end if;
    end if;
  else decision := 'entitlement_inconsistent';
  end if;
  return jsonb_build_object('enforced',coalesce(settings.plan_enforcement_enabled,true),'allowed',decision='eligible',
    'reason',decision,'source',source_kind,'access_ends_at',ends_at,'plan_revision',plan.revision);
end $$;

create function private.assert_repolight_analysis_access_v1(p_subject uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare access jsonb;
begin
  access := public.get_repolight_analysis_access_v1(p_subject);
  if (access->>'enforced')::boolean and not (access->>'allowed')::boolean then
    raise exception using errcode='P2961',message='repolight_analysis_access_required';
  end if;
end $$;

revoke all on function private.lock_repolight_analysis_access_v1(uuid),
  private.assert_repolight_analysis_access_v1(uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_repolight_analysis_access_v1(uuid) from public,anon,authenticated;
grant execute on function public.get_repolight_analysis_access_v1(uuid) to service_role;


create or replace function public.begin_assignment_repolight_run_v1(p_actor_id uuid,p_assignment_id uuid,p_student_id uuid,p_request_id uuid,p_connection jsonb,p_request jsonb,p_expected_source jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare cid uuid; source jsonb; r public.assignment_repolight_runs; b private.repolight_subject_bindings; envelope jsonb; fingerprint text;
begin
 -- Acquire account fences before the historical target locks, even when dormant.
 perform private.lock_repolight_analysis_access_v1(p_actor_id);
 cid:=private.authorize_repolight_target_v1(p_actor_id,p_assignment_id,p_student_id,true);
 perform private.assert_repolight_analysis_access_v1(p_actor_id);
 if not exists(select 1 from private.repolight_settings where singleton and enabled) then raise exception using errcode='55000',message='repolight_disabled';end if;
 source:=private.repolight_source_v1(p_assignment_id,p_student_id);
 if source is distinct from p_expected_source then raise exception using errcode='40001',message='repolight_source_changed';end if;
 if p_request_id is null or jsonb_typeof(p_connection) is distinct from 'object' or not(p_connection ?& array['connectionRef','workspaceRef','installationRef']) or (select count(*) from jsonb_object_keys(p_connection))<>3
 or exists(select 1 from jsonb_each_text(p_connection)e where e.value !~ '^[A-Za-z0-9._~-]{1,128}$')
 or jsonb_typeof(p_request) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_request)k where k<>all(array['repositoryUrl','branch','githubUsername','period','scheduledProjectDates','baselineReviewed','exclusions'])) or not(p_request ?& array['repositoryUrl','period','scheduledProjectDates','baselineReviewed','exclusions']) or octet_length(p_request::text)>64000 or coalesce(p_request->>'repositoryUrl','') !~ '^https://github.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
 then raise exception using errcode='22023',message='Invalid RepoLight request';end if;
 -- Bind repository selection to saved work/teacher override; never use repo owner as username.
 if p_request->>'repositoryUrl' is distinct from regexp_replace(source#>>'{repo_target,selected_repo_url}','[.]git$','') and p_request->>'repositoryUrl' is distinct from regexp_replace(source#>>'{doc,repo_url}','[.]git$','')
 and not exists(select 1 from jsonb_array_elements(source->'artifacts')a where a->>'type'='repo_link' and (regexp_replace(a->>'url','[.]git$','')=p_request->>'repositoryUrl' or regexp_replace(a#>>'{metadata_json,normalized_url}','[.]git$','')=p_request->>'repositoryUrl')) then raise exception using errcode='22023',message='Repository is not submitted';end if;
 select * into r from public.assignment_repolight_runs where id=p_request_id for update;
 if found then
  if r.detached then raise exception using errcode='55000',message='repolight_detached_report';end if;
  if r.assignment_id<>p_assignment_id or r.student_id<>p_student_id or r.actor_id<>p_actor_id or r.request_json<>p_request or r.connection_json<>p_connection or r.source_json<>source then raise exception using errcode='40001',message='repolight_intent_conflict';end if;
  -- Exact replay never creates another subject, including after cleanup closes
  -- this intent. Retire only its operational authority and return that outcome.
  if r.status in('queued','submitting','running') and not exists(select 1 from private.repolight_subject_bindings where id=r.subject_binding_id and state='active') then
   update public.assignment_repolight_runs set status='stale',error_code='repolight_subject_closed',next_retry_at=null,lease_token=null,lease_generation=lease_generation+1,lease_expires_at=null,completed_at=clock_timestamp() where id=r.id returning * into r;
  end if;
  return to_jsonb(r);
 end if;
 if exists(select 1 from private.repolight_subject_bindings where intent_id=p_request_id) then raise exception using errcode='55000',message='repolight_subject_closed';end if;
 -- Only an authorized POST with validated current input may supersede an active
 -- target. Preserve inputs, remote IDs, facts and every uncertain cleanup intent.
 update public.assignment_repolight_runs old_run set status='stale',error_code='repolight_superseded',next_retry_at=null,lease_token=null,lease_generation=old_run.lease_generation+1,lease_expires_at=null,completed_at=clock_timestamp()
 where old_run.assignment_id=p_assignment_id and old_run.student_id=p_student_id and old_run.status in('queued','submitting','running') and
 (old_run.source_json is distinct from source or old_run.request_json is distinct from p_request or old_run.connection_json is distinct from p_connection or not exists(select 1 from private.repolight_subject_bindings where id=old_run.subject_binding_id and state='active'));
 if exists(select 1 from public.assignment_repolight_runs where assignment_id=p_assignment_id and student_id=p_student_id and status in('queued','submitting','running')) then raise exception using errcode='40001',message='repolight_run_active';end if;
 fingerprint:=private.repolight_digest_v1(source);
 insert into private.repolight_subject_bindings(intent_id,teacher_id,classroom_id,assignment_id,student_id,enrollment_id,scope_digest,connection_ref,workspace_ref,installation_ref)
 values(p_request_id,p_actor_id,cid,p_assignment_id,p_student_id,(source#>>'{enrollment,id}')::uuid,private.repolight_digest_v1(jsonb_build_array(cid,p_assignment_id,p_student_id,p_request_id)),p_connection->>'connectionRef',p_connection->>'workspaceRef',p_connection->>'installationRef') returning * into b;
 envelope:=jsonb_build_object('schemaVersion','1.0','request',p_request,'clientBinding',jsonb_build_object('installationRef',b.installation_ref,'subjectRef',b.subject_ref,'sourceRevisionRef',fingerprint));
 insert into public.assignment_repolight_runs(id,subject_binding_id,classroom_id,assignment_id,student_id,actor_id,source_json,source_fingerprint,connection_json,request_json,create_envelope,request_fingerprint,idempotency_key)
 values(p_request_id,b.id,cid,p_assignment_id,p_student_id,p_actor_id,source,fingerprint,p_connection,p_request,envelope,private.repolight_digest_v1(envelope),'pika-'||p_request_id::text) returning * into r;
 return to_jsonb(r);
end $$;

create or replace function public.advance_assignment_repolight_run_v1(p_actor_id uuid,p_assignment_id uuid,p_student_id uuid,p_run_id uuid,p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.assignment_repolight_runs; b private.repolight_subject_bindings; result jsonb; can_retry boolean;
begin
 -- Acquire account fences before the historical target locks, even when dormant.
 perform private.lock_repolight_analysis_access_v1(p_actor_id);
 perform private.authorize_repolight_target_v1(p_actor_id,p_assignment_id,p_student_id,true);
 select * into r from public.assignment_repolight_runs where id=p_run_id and assignment_id=p_assignment_id and student_id=p_student_id for update;
 if not found then raise exception using errcode='P0002',message='Analysis not found';end if;
 if r.actor_id<>p_actor_id then raise exception using errcode='42501',message='Forbidden';end if;
 if r.detached then raise exception using errcode='55000',message='repolight_detached_report';end if;
 if r.status='stale' then raise exception using errcode='40001',message='repolight_lease_lost';end if;
 select * into b from private.repolight_subject_bindings where id=r.subject_binding_id for update;
 if b.state<>'active' then raise exception using errcode='55000',message='repolight_subject_closed';end if;
 if r.source_json is distinct from private.repolight_source_v1(p_assignment_id,p_student_id) then raise exception using errcode='40001',message='repolight_source_changed';end if;
 -- A known remote job may settle after expiry. Unknown outcomes still require
 -- create permission: reconcileAnalysis re-POSTs create and can start work.
 if r.analysis_id is null and p_action in ('claim','authorize') then
  perform private.assert_repolight_analysis_access_v1(p_actor_id);
 end if;
 if r.status in('completed','failed') then
  if p_action is distinct from 'claim' then raise exception using errcode='40001',message='repolight_lease_lost';end if;
  return to_jsonb(r);
 end if;
 if p_action='claim' then
  if r.lease_expires_at>clock_timestamp() or r.next_retry_at>clock_timestamp() then return to_jsonb(r)-'lease_token';end if;
  if (r.analysis_id is null and r.attempt_count>=3) or (r.analysis_id is not null and r.poll_failure_count>=3) or r.created_at<clock_timestamp()-interval '24 hours' then
   update public.assignment_repolight_runs set status='failed',error_code='attempts_exhausted',completed_at=clock_timestamp(),lease_token=null,lease_expires_at=null where id=r.id returning * into r;return to_jsonb(r);
  end if;
  update public.assignment_repolight_runs set status=case when analysis_id is null then 'submitting' else 'running' end,lease_token=gen_random_uuid(),lease_generation=lease_generation+1,lease_expires_at=clock_timestamp()+interval '90 seconds',attempt_count=attempt_count+case when analysis_id is null then 1 else 0 end,next_retry_at=null where id=r.id returning * into r;
  return to_jsonb(r);
 end if;
 if r.lease_token is null or r.lease_token is distinct from (p_payload->>'leaseToken')::uuid or r.lease_generation is distinct from (p_payload->>'leaseGeneration')::integer or r.lease_expires_at<=clock_timestamp() then raise exception using errcode='40001',message='repolight_lease_lost';end if;
 if p_action='authorize' then return to_jsonb(r);end if;
 if p_action='poll_pending' then
  update public.assignment_repolight_runs set status='running',lease_token=null,lease_expires_at=null,next_retry_at=clock_timestamp()+interval '5 seconds' where id=r.id returning * into r;
 elsif p_action='record_remote' then
  if r.analysis_id is not null and r.analysis_id is distinct from (p_payload->>'analysisId')::uuid then raise exception using errcode='40001',message='repolight_remote_conflict';end if;
  update public.assignment_repolight_runs set analysis_id=(p_payload->>'analysisId')::uuid,status='running' where id=r.id returning * into r;
 elsif p_action='complete' then
  result:=p_payload->'result';
  if r.analysis_id is null or result->>'schemaVersion' is distinct from '1.0' or result->>'analysisId' is distinct from r.analysis_id::text or result->>'reportRef' is distinct from r.analysis_id::text or result#>>'{bundle,bundleRef}' is distinct from r.analysis_id::text or result->>'requestFingerprint' is distinct from r.request_fingerprint or result->'clientBinding' is distinct from r.create_envelope->'clientBinding' or result->>'reportDigest' is distinct from private.repolight_digest_v1(result->'bundle') then raise exception using errcode='22023',message='repolight_result_binding_invalid';end if;
  insert into public.assignment_repolight_reports(run_id,assignment_id,student_id,report_ref,report_digest,result_json) values(r.id,r.assignment_id,r.student_id,r.analysis_id,result->>'reportDigest',result);
  update public.assignment_repolight_runs set status='completed',completed_at=clock_timestamp(),lease_token=null,lease_expires_at=null,error_code=null where id=r.id returning * into r;
 elsif p_action='retry' then
  if p_payload->>'errorCode' !~ '^[a-z_]{1,64}$' then raise exception using errcode='22023',message='Invalid safe error';end if;
  can_retry:=coalesce((p_payload->>'retryable')::boolean,false) and case when r.analysis_id is null then r.attempt_count<3 else r.poll_failure_count+1<3 end;
  if r.analysis_id is not null then update public.assignment_repolight_runs set poll_failure_count=least(3,poll_failure_count+1) where id=r.id;end if;
  update public.assignment_repolight_runs set status=case when can_retry then 'queued' else 'failed' end,error_code=p_payload->>'errorCode',next_retry_at=case when can_retry then clock_timestamp()+interval '15 seconds' else null end,completed_at=case when can_retry then null else clock_timestamp() end,lease_token=null,lease_expires_at=null where id=r.id returning * into r;
 else raise exception using errcode='22023',message='Invalid RepoLight transition';end if;
 return to_jsonb(r);
end $$;

-- Eligibility metadata is a projection only. Saved reports remain readable.
create or replace function public.get_assignment_repolight_source_v1(p_actor_id uuid,p_assignment_id uuid,p_student_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare source jsonb;
begin
 perform private.lock_repolight_analysis_access_v1(p_actor_id);
 perform private.authorize_repolight_target_v1(p_actor_id,p_assignment_id,p_student_id,false);
 source:=private.repolight_source_v1(p_assignment_id,p_student_id);
 return jsonb_build_object('analysis_access',public.get_repolight_analysis_access_v1(p_actor_id),'source',source,'source_fingerprint',private.repolight_digest_v1(source),'latest_run',(select to_jsonb(r) from public.assignment_repolight_runs r where r.assignment_id=p_assignment_id and r.student_id=p_student_id order by r.created_at desc,r.id desc limit 1));
end $$;

-- Eligibility metadata is a projection only. Saved reports remain readable.
create or replace function public.read_assignment_repolight_run_v1(p_actor_id uuid,p_assignment_id uuid,p_student_id uuid,p_run_id uuid,p_include_report boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.assignment_repolight_runs; result jsonb;
begin
 perform private.lock_repolight_analysis_access_v1(p_actor_id);
 perform private.authorize_repolight_target_v1(p_actor_id,p_assignment_id,p_student_id,false);
 select * into r from public.assignment_repolight_runs where id=p_run_id and assignment_id=p_assignment_id and student_id=p_student_id;
 if not found then raise exception using errcode='P0002',message='Analysis not found';end if;
 result:=to_jsonb(r)||jsonb_build_object('analysis_access',public.get_repolight_analysis_access_v1(p_actor_id),'source_current',not r.detached and r.source_json=private.repolight_source_v1(p_assignment_id,p_student_id));
 if p_include_report then result:=result||jsonb_build_object('report',(select result_json from public.assignment_repolight_reports where run_id=r.id));end if;
 return result;
end $$;

commit;
