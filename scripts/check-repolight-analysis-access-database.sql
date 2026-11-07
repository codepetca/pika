-- Rollback-only: use only in the owned offline full-schema replay.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

do $$ begin
  if exists(select 1 from private.repolight_settings where singleton and
    (plan_enforcement_enabled or legacy_plan_access_enabled or billing_access_enabled)) then
    raise exception 'Access rollout unexpectedly active';
  end if;
  if has_function_privilege('anon','public.get_repolight_analysis_access_v1(uuid)','execute')
    or has_function_privilege('authenticated','public.get_repolight_analysis_access_v1(uuid)','execute')
    or not has_function_privilege('service_role','public.get_repolight_analysis_access_v1(uuid)','execute')
    or has_function_privilege('service_role','private.assert_repolight_analysis_access_v1(uuid)','execute')
    or has_table_privilege('service_role','private.repolight_settings','update') then
    raise exception 'Access control privileges drifted';
  end if;
end $$;

insert into public.users(id,email,role) values
 ('f2960000-0000-4000-8000-000000000001','repolight-access-owner@example.invalid','student'),
 ('f2960000-0000-4000-8000-000000000002','repolight-access-student@example.invalid','student'),
 ('f2960000-0000-4000-8000-000000000003','repolight-access-trial@example.invalid','teacher'),
 ('f2960000-0000-4000-8000-000000000004','repolight-access-paid@example.invalid','teacher'),
 ('f2960000-0000-4000-8000-000000000005','repolight-access-old-offering@example.invalid','teacher');
do $$ declare actor uuid:='f2960000-0000-4000-8000-000000000001'; p text; r jsonb; rev bigint; begin
  if public.get_repolight_analysis_access_v1(actor)->>'allowed'<>'false' then raise exception 'Missing plan allowed'; end if;
  foreach p in array array['free','basic','plus','pro'] loop
    select coalesce(max(revision),0) into rev from public.account_plans where subject_user_id=actor;
    perform public.set_account_plan_v1(gen_random_uuid(),actor,p,'test:repolight296','fixture',rev);
    r:=public.get_repolight_analysis_access_v1(actor);
    if (r->>'enforced')::boolean or (r->>'allowed')::boolean then raise exception 'Dormant access granted entitlement'; end if;
  end loop;
end $$;
update private.repolight_settings set legacy_plan_access_enabled=true,plan_enforcement_enabled=true,enabled=true where singleton;
do $$ declare actor uuid:='f2960000-0000-4000-8000-000000000001'; p text; r jsonb; rev bigint; begin
  foreach p in array array['free','basic','plus','pro'] loop
    select revision into rev from public.account_plans where subject_user_id=actor;
    perform public.set_account_plan_v1(gen_random_uuid(),actor,p,'test:repolight296','fixture',rev);
    r:=public.get_repolight_analysis_access_v1(actor);
    if (r->>'allowed')::boolean is distinct from (p in ('plus','pro')) then raise exception 'Legacy tier decision differs: %',r; end if;
  end loop;
  -- A direct/manual creation grant must not silently become a paid benefit.
  select revision into rev from public.effective_feature_entitlements where subject_user_id=actor and feature_key='classrooms.create';
  perform public.set_effective_feature_entitlement_v1(gen_random_uuid(),actor,'classrooms.create','manual',true,clock_timestamp(),null,10,'test:repolight296','fixture',rev);
  if public.get_repolight_analysis_access_v1(actor)->>'reason'<>'entitlement_inconsistent' then raise exception 'Manual override bypassed plan binding'; end if;
  select revision into rev from public.account_plans where subject_user_id=actor;
  perform public.set_account_plan_v1(gen_random_uuid(),actor,'plus','test:repolight296','fixture',rev);
  update public.effective_feature_entitlements set starts_at=clock_timestamp()+interval '1 day'
    where subject_user_id=actor and feature_key='classrooms.create';
  if public.get_repolight_analysis_access_v1(actor)->>'reason'<>'not_started' then raise exception 'Future legacy access allowed'; end if;
  update public.effective_feature_entitlements set starts_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 day'
    where subject_user_id=actor and feature_key='classrooms.create';
  if public.get_repolight_analysis_access_v1(actor)->>'reason'<>'expired' then raise exception 'Elapsed legacy access allowed'; end if;
  update public.effective_feature_entitlements set starts_at=clock_timestamp()-interval '1 day',expires_at=null
    where subject_user_id=actor and feature_key='classrooms.create';
end $$;

insert into public.classrooms(id,teacher_id,title,class_code) values('f2960000-0000-4000-8000-000000000010','f2960000-0000-4000-8000-000000000001','RepoLight access fixture','R296FX');
insert into public.classroom_enrollments(id,classroom_id,student_id) values('f2960000-0000-4000-8000-000000000011','f2960000-0000-4000-8000-000000000010','f2960000-0000-4000-8000-000000000002');
insert into public.assignments(id,classroom_id,title,description,due_at,created_by,is_draft,released_at) values('f2960000-0000-4000-8000-000000000020','f2960000-0000-4000-8000-000000000010','Access fixture','','2026-10-25T04:00:00Z','f2960000-0000-4000-8000-000000000001',false,'2026-09-01T04:00:00Z');
insert into public.assignment_docs(id,assignment_id,student_id,repo_url,teacher_feedback_draft) values('f2960000-0000-4000-8000-000000000030','f2960000-0000-4000-8000-000000000020','f2960000-0000-4000-8000-000000000002','https://github.com/example/project','Existing draft');

set local role service_role;
do $$ declare actor uuid:='f2960000-0000-4000-8000-000000000001'; assignment uuid:='f2960000-0000-4000-8000-000000000020'; student uuid:='f2960000-0000-4000-8000-000000000002'; r jsonb; source jsonb; begin
  source:=public.get_assignment_repolight_source_v1(actor,assignment,student);
  r:=public.begin_assignment_repolight_run_v1(actor,assignment,student,'f2960000-0000-4000-8000-000000000040',
    '{"connectionRef":"fixture","workspaceRef":"fixture_workspace","installationRef":"pika_fixture"}',
    '{"repositoryUrl":"https://github.com/example/project","period":{"startAt":"2026-09-01T04:00:00Z","endAt":"2026-10-25T04:00:00Z","timezone":"America/Toronto"},"scheduledProjectDates":null,"baselineReviewed":false,"exclusions":{"commitShas":[],"pathPrefixes":[],"botLogins":[]}}',source->'source');
  perform public.advance_assignment_repolight_run_v1(actor,assignment,student,(r->>'id')::uuid,'claim','{}');
end $$;
reset role;
-- Losing access between claim and authorize must prevent create/reconcile.
do $$ declare actor uuid:='f2960000-0000-4000-8000-000000000001'; rev bigint; begin
  select revision into rev from public.account_plans where subject_user_id=actor;
  perform public.set_account_plan_v1(gen_random_uuid(),actor,'free','test:repolight296','fixture',rev);
end $$;
set local role service_role;
do $$ declare actor uuid:='f2960000-0000-4000-8000-000000000001'; assignment uuid:='f2960000-0000-4000-8000-000000000020'; student uuid:='f2960000-0000-4000-8000-000000000002'; run uuid:='f2960000-0000-4000-8000-000000000040'; r jsonb; lease jsonb; report jsonb; before_doc jsonb; after_doc jsonb; begin
  r:=public.read_assignment_repolight_run_v1(actor,assignment,student,run,false);
  if r#>>'{analysis_access,allowed}'<>'false' or r#>>'{analysis_access,enforced}'<>'true' then raise exception 'Run projection missed entitlement denial'; end if;
  if public.get_assignment_repolight_source_v1(actor,assignment,student)#>>'{analysis_access,allowed}'<>'false' then raise exception 'Context projection missed entitlement denial'; end if;
  lease:=jsonb_build_object('leaseToken',r->>'lease_token','leaseGeneration',r->'lease_generation');
  begin perform public.advance_assignment_repolight_run_v1(actor,assignment,student,run,'authorize',lease); raise exception 'Unknown-create retry allowed after downgrade'; exception when sqlstate 'P2961' then null; end;
  begin perform public.advance_assignment_repolight_run_v1(actor,assignment,student,run,'claim','{}'); raise exception 'Unknown-create claim allowed after downgrade'; exception when sqlstate 'P2961' then null; end;
  begin perform public.begin_assignment_repolight_run_v1(actor,assignment,student,gen_random_uuid(),r->'connection_json',r->'request_json',r->'source_json'); raise exception 'New analysis allowed after downgrade'; exception when sqlstate 'P2961' then null; end;
  -- Successful HTTP may race expiry. Saving its already-created ID is allowed;
  -- thereafter polling/results do not request a new analysis or paid entitlement.
  perform public.advance_assignment_repolight_run_v1(actor,assignment,student,run,'record_remote',lease||jsonb_build_object('analysisId','f2930000-0000-4000-8000-000000000050'));
  perform public.advance_assignment_repolight_run_v1(actor,assignment,student,run,'claim','{}');
  perform public.advance_assignment_repolight_run_v1(actor,assignment,student,run,'authorize',lease);
  report:=jsonb_build_object('schemaVersion','1.0','analysisId','f2930000-0000-4000-8000-000000000050','reportRef','f2930000-0000-4000-8000-000000000050','requestFingerprint',r->>'request_fingerprint','clientBinding',r#>'{create_envelope,clientBinding}',
    'reportDigest','fc9d5fb85eb1ca43ae71125700032fda8dc1222c0e6db9f550a877a0ad842357','bundle',jsonb_build_object('schemaVersion','1.0','bundleRef','f2930000-0000-4000-8000-000000000050','overview',jsonb_build_object('ruleFeedback',jsonb_build_object('feedbackDraft','Generated review')),'contributors','[]'::jsonb));
  perform public.advance_assignment_repolight_run_v1(actor,assignment,student,run,'complete',lease||jsonb_build_object('result',report));
  if public.read_assignment_repolight_run_v1(actor,assignment,student,run,true)->'report' is distinct from report then raise exception 'Saved report lost after downgrade'; end if;
  select to_jsonb(d) into before_doc from public.assignment_docs d where d.assignment_id=assignment and d.student_id=student;
  perform public.import_assignment_repolight_feedback_v1(actor,assignment,student,run,gen_random_uuid(),'repository',(before_doc->>'updated_at')::timestamptz,report->>'reportDigest',null);
  select to_jsonb(d) into after_doc from public.assignment_docs d where d.assignment_id=assignment and d.student_id=student;
  if after_doc->>'teacher_feedback_draft'<>E'Existing draft\n\nGenerated review'
    or (before_doc-array['teacher_feedback_draft','teacher_feedback_draft_updated_at','updated_at']) is distinct from (after_doc-array['teacher_feedback_draft','teacher_feedback_draft_updated_at','updated_at']) then raise exception 'Feedback or academic work lost'; end if;
  r:=public.begin_repolight_subject_erasure_v1(actor,(r->>'subject_binding_id')::uuid,gen_random_uuid());
  perform public.record_repolight_subject_erasure_v1(actor,(r->>'id')::uuid,(r->>'operation_id')::uuid,
    jsonb_build_object('schemaVersion','1.0','operationRef',r->>'operation_id','installationRef',r->>'installation_ref','subjectRef',r->>'subject_ref','status','erased','absenceVerified',true));
end $$;
reset role;

-- Genuine trial and paid lifecycle writers, behind disposable sandbox settings.
update private.stripe_billing_settings set sandbox_enabled=true where singleton;
update private.repolight_settings set billing_access_enabled=true where singleton;
do $$ declare actor uuid:='f2960000-0000-4000-8000-000000000003'; r jsonb; t timestamptz; begin
  if not exists(select 1 from public.account_plans where subject_user_id=actor) then
    perform public.set_account_plan_v1(gen_random_uuid(),actor,'free','test:repolight296','fixture',0);
  end if;
  perform public.billing_start_trial_v1(jsonb_build_object('subject_user_id',actor,'operation_id',gen_random_uuid()));
  r:=public.get_repolight_analysis_access_v1(actor);
  if r->>'allowed'<>'true' or r->>'source'<>'trial' then raise exception 'Active Pro trial denied: %',r; end if;
  update public.billing_trials set converted_to_paid_at=clock_timestamp() where subject_user_id=actor;
  if public.get_repolight_analysis_access_v1(actor)->>'reason'<>'entitlement_inconsistent' then raise exception 'Converted trial reused'; end if;
  update public.billing_trials set converted_to_paid_at=null where subject_user_id=actor;
  -- The worker is deliberately not run. Expiry reads must still deny access.
  t:=clock_timestamp()-interval '1 second';
  update public.billing_trials set started_at=t-interval '720 hours',ends_at=t where subject_user_id=actor;
  update public.billing_account_access set starts_at=t-interval '720 hours',access_ends_at=t where subject_user_id=actor;
  update public.effective_feature_entitlements set starts_at=t-interval '720 hours',expires_at=t where subject_user_id=actor and feature_key='classrooms.create';
  if public.get_repolight_analysis_access_v1(actor)->>'reason'<>'expired' then raise exception 'Trial expiry depends on worker'; end if;
end $$;

do $$ declare actor uuid; included boolean; offering jsonb; bound jsonb; claim jsonb; r jsonb; deadline timestamptz:=clock_timestamp()+interval '24 hours'; rev bigint; suffix text; begin
  for actor,included,suffix in select * from (values
    ('f2960000-0000-4000-8000-000000000004'::uuid,true,'new296'),
    ('f2960000-0000-4000-8000-000000000005'::uuid,false,'old296')) as fixture(id,benefit,label) loop
    if not exists(select 1 from public.account_plans where subject_user_id=actor) then
      perform public.set_account_plan_v1(gen_random_uuid(),actor,'free','test:repolight296','fixture',0);
    end if;
    offering:=public.billing_register_offering_v1(jsonb_build_object('plan_key','plus','version',case when included then 9296 else 9297 end,
      'stripe_account','acct_access296','provider_mode','test','stripe_product_id','prod_'||suffix,'stripe_price_id','price_'||suffix,
      'currency','usd','unit_amount',1900,'interval','month','classroom_limit',5,
      'features',case when included then '{"repolight_analysis":true}'::jsonb else '{}'::jsonb end,'ai_definition',null,'availability',jsonb_build_object('is_available',true)));
    bound:=public.billing_bind_customer_v1(jsonb_build_object('subject_user_id',actor,'stripe_account','acct_access296','provider_mode','test','stripe_price_id','price_'||suffix,'stripe_customer_id','cus_'||suffix,'stripe_subscription_id','sub_'||suffix,'offering_version_id',offering->>'offering_version_id'));
    claim:=public.billing_claim_subscription_v1(jsonb_build_object('subscription_id',bound->>'subscription_id','lease_seconds',120));
    r:=public.billing_finish_lifecycle_v1(jsonb_build_object('subscription_id',bound->>'subscription_id','lease_token',claim->>'lease_token','fencing_token',claim->'fencing_token','expected_subscription_revision',claim->'subscription_revision','expected_account_plan_revision',claim->'expected_account_plan_revision',
      'outcome','paid','event_inbox_id',null,'invoice_id','in_'||suffix,'period_start',deadline-interval '30 days','period_end',deadline,'reason_code',null,'provider_status','active','cancel_at_period_end',false,'obligations_cleared',false));
    if r->>'status'<>'applied' then raise exception 'Paid fixture failed: %',r; end if;
    r:=public.get_repolight_analysis_access_v1(actor);
    if (r->>'allowed')::boolean is distinct from included then raise exception 'Purchased feature binding differs: %',r; end if;
    if included then
      -- Keep the existing paid-through/receipt identity, but exercise real grace
      -- facts and its exclusive end without waiting for lifecycle maintenance.
      update public.billing_account_access set access_ends_at=paid_through+interval '168 hours',end_reason='renewal_grace',failed_renewal_invoice_id='in_failed296' where subject_user_id=actor;
      update public.effective_feature_entitlements set expires_at=deadline+interval '168 hours' where subject_user_id=actor and feature_key='classrooms.create';
      if public.get_repolight_analysis_access_v1(actor)->>'allowed'<>'true' then raise exception 'Valid grace denied'; end if;
      update public.billing_account_access set entitlement_revision=entitlement_revision+1 where subject_user_id=actor;
      if public.get_repolight_analysis_access_v1(actor)->>'reason'<>'entitlement_inconsistent' then raise exception 'Revision mismatch allowed'; end if;
    end if;
  end loop;
end $$;

rollback;
