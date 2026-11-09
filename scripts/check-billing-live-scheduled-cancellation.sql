-- Rollback-only proof of the scoped live schedule cancellation. No Stripe calls.
begin;
set local statement_timeout='30s';
set local lock_timeout='3s';

create temporary table live_cancel_325(
  kind text primary key,subject_id uuid,subscription_id uuid,schedule_id uuid,effective_at timestamptz,invoice_id text
);

create function pg_temp.cancel_command_325(p_id uuid,p_action text,p_fence jsonb default null,p_outcome text default null,p_evidence jsonb default null)
returns jsonb language sql as $$
  select public.billing_live_scheduled_cancellation_command_v1('abcdefghijklmnopqrst','acct_Live325',
    jsonb_strip_nulls(jsonb_build_object('operation_id',p_id,'action',p_action,'fence',p_fence,'outcome',p_outcome,'evidence',p_evidence)));
$$;

do $$
declare
  project constant text:='abcdefghijklmnopqrst'; account constant text:='acct_Live325';
  v_user uuid; v_attempt uuid; v_subscription uuid; v_schedule uuid; v_max uuid; v_pro uuid; v_effective timestamptz; v_start timestamptz;
  v_invoice text; v_case text; v_terms record; v_request jsonb; v_claim jsonb; v_result jsonb; v_offering jsonb; v_rpc text;
begin
  foreach v_rpc in array array['billing_get_live_scheduled_cancellation_v1','billing_request_live_scheduled_cancellation_v1',
    'billing_list_live_scheduled_cancellations_v1','billing_live_scheduled_cancellation_command_v1'] loop
    if has_function_privilege('anon','public.'||v_rpc||'(text,text,jsonb)','execute')
      or has_function_privilege('authenticated','public.'||v_rpc||'(text,text,jsonb)','execute')
      or not has_function_privilege('service_role','public.'||v_rpc||'(text,text,jsonb)','execute') then
      raise exception 'Live cancellation ACL differs for %',v_rpc;
    end if;
  end loop;
  if has_function_privilege('authenticated','public.billing_live_scheduled_customer_ready_v1(text,text)','execute')
    or not has_function_privilege('service_role','public.billing_live_scheduled_customer_ready_v1(text,text)','execute')
    or has_table_privilege('service_role','private.billing_live_scheduled_cancellations','insert')
    or exists(select 1 from private.stripe_billing_settings where singleton
      and (live_scheduled_cancellation_admission_enabled or live_scheduled_cancellation_provider_writes_enabled)) then
    raise exception 'Cancellation default-off scope differs';
  end if;
  update private.stripe_billing_settings set live_project_ref=project,live_stripe_account=account,
    classroom_new_work_cutoff_enabled=true where singleton;
  update private.stripe_billing_settings set live_payment_lifecycle_enabled=true,live_closeout_enabled=true,
    live_checkout_admission_enabled=true,live_checkout_writes_enabled=true where singleton;
  for v_terms in select * from (values
    ('pro','max','Max',3900,12,'prod_Max325','price_Max325'),
    ('plus','pro','Pro',1900,5,'prod_Pro325','price_Pro325')
  ) as versions(plan,public_plan,name,amount,classroom_limit,product,price) loop
    v_result:=public.billing_register_live_checkout_offering_v1(project,account,jsonb_build_object(
      'plan_key',v_terms.plan,'version',325001,'stripe_account',account,'provider_mode','live',
      'stripe_product_id',v_terms.product,'stripe_price_id',v_terms.price,'currency','usd','interval','month',
      'unit_amount',v_terms.amount,'classroom_limit',v_terms.classroom_limit,'features',jsonb_build_object(
        'catalog_key','pika:repolight-2026-10-29:'||v_terms.public_plan||':usd:month',
        'display_name',v_terms.name,'release_tag','repolight-2026-10-29','repolight_analysis',true),
      'ai_definition',null,'availability',jsonb_build_object('is_available',true)));
    if v_terms.plan='pro' then v_max:=(v_result->>'offering_version_id')::uuid;
    else v_pro:=(v_result->>'offering_version_id')::uuid; end if;
  end loop;
  v_offering:=public.billing_get_live_checkout_offering_v1(project,account,jsonb_build_object('offering_version_id',v_max,'stripe_account',account));
  foreach v_case in array array['cycle','complete','pristine','install','lateundo','unchanged','undoterminal'] loop
    v_user:=gen_random_uuid(); v_attempt:=gen_random_uuid(); v_schedule:=gen_random_uuid();
    insert into public.users(id,email,role) values(v_user,'cancellation325-'||v_case||'@example.invalid','teacher');
    perform public.set_account_plan_v1(gen_random_uuid(),v_user,'free','test:cancel325','fixture',
      coalesce((select revision from public.account_plans where subject_user_id=v_user),0));
    perform public.billing_reserve_live_checkout_v1(project,account,jsonb_build_object(
      'attempt_id',v_attempt,'subject_user_id',v_user,'offering',v_offering,'lookup_key',v_offering->>'catalog_key',
      'success_url','https://pika.codepet.ca/billing?checkout='||v_attempt||'&result=success',
      'cancel_url','https://pika.codepet.ca/billing?checkout='||v_attempt||'&result=cancel'));
    v_claim:=public.billing_claim_live_checkout_v1(project,account,jsonb_build_object('attempt_id',v_attempt,'lease_seconds',120));
    v_request:=jsonb_build_object('attempt_id',v_attempt,'lease_token',v_claim->'lease_token','fencing_token',v_claim->'fencing_token');
    perform public.billing_save_live_checkout_progress_v1(project,account,v_request||jsonb_build_object(
      'customer_id','cus_Live325'||v_case,'session_id','cs_live_Live325'||v_case));
    perform public.billing_finish_live_checkout_v1(project,account,v_request||jsonb_build_object('outcome','bound','subscription_id','sub_Live325'||v_case));
    select id into strict v_subscription from public.stripe_billing_subscription_bindings where subject_user_id=v_user;
    v_effective:=date_trunc('second',clock_timestamp())+case when v_case in ('cycle','install') then interval '2 days' else -interval '2 days' end;
    v_start:=v_effective-interval '1 month'; v_invoice:='in_Max325'||v_case;
    v_claim:=public.billing_claim_live_subscription_v1(project,account,jsonb_build_object('subscription_id',v_subscription,'lease_seconds',120));
    v_request:=jsonb_build_object('subscription_id',v_subscription,'lease_token',v_claim->'lease_token',
      'fencing_token',v_claim->'fencing_token','expected_subscription_revision',v_claim->'subscription_revision',
      'expected_account_plan_revision',v_claim->'expected_account_plan_revision',
      'provider_status','active','cancel_at_period_end',false,'obligations_cleared',false,
      'outcome','paid','invoice_id',v_invoice,'period_start',v_start,'period_end',v_effective);
    if public.billing_finish_live_lifecycle_v1(project,account,v_request)->>'status' is distinct from 'applied' then
      raise exception 'Fixture did not settle source Max %',v_case; end if;
    insert into private.billing_scheduled_plan_changes(id,subject_user_id,subscription_id,source_offering_version_id,
      target_offering_version_id,paid_period_start,effective_at,quote_expires_at,last_paid_invoice_id,
      expected_plan_revision,expected_access_revision,expected_entitlement_revision,state,confirmed_at,provider_schedule_id)
      select v_schedule,v_user,v_subscription,v_max,v_pro,v_start,v_effective,v_effective-interval '15 minutes',v_invoice,
        access.account_plan_revision,access.revision,access.entitlement_revision,
        case when v_case='install' then 'confirmed' else 'scheduled' end,v_effective-interval '1 day',
        case when v_case<>'install' then 'sub_sched_Live325'||v_case end
      from public.billing_account_access access where access.subject_user_id=v_user;
    insert into live_cancel_325 values(v_case,v_user,v_subscription,v_schedule,v_effective,v_invoice);
  end loop;
end;
$$;

do $$
declare
  project constant text:='abcdefghijklmnopqrst'; account constant text:='acct_Live325';
  cycle live_cancel_325%rowtype; install live_cancel_325%rowtype; complete live_cancel_325%rowtype; pristine live_cancel_325%rowtype;
  op uuid:=gen_random_uuid(); fresh_op uuid:=gen_random_uuid(); completed_op uuid:=gen_random_uuid(); pristine_op uuid:=gen_random_uuid();
  r jsonb; c jsonb; f jsonb; req jsonb; end_evidence jsonb; unchanged jsonb;
begin
  select * into strict cycle from live_cancel_325 where kind='cycle';
  select * into strict install from live_cancel_325 where kind='install';
  select * into strict complete from live_cancel_325 where kind='complete';
  select * into strict pristine from live_cancel_325 where kind='pristine';
  if public.billing_get_live_scheduled_cancellation_v1(project,account,jsonb_build_object('subject_user_id',install.subject_id))->>'state'
    is distinct from 'install_pending' then raise exception 'Durable installation pending state was hidden'; end if;
  update private.billing_scheduled_plan_changes set installation_attention_at=clock_timestamp() where id=install.schedule_id;
  if public.billing_get_live_scheduled_cancellation_v1(project,account,jsonb_build_object('subject_user_id',install.subject_id))->>'state'
    is distinct from 'attention' then raise exception 'Installation attention was hidden'; end if;
  req:=jsonb_build_object('subject_user_id',cycle.subject_id,'schedule_operation_id',cycle.schedule_id,'operation_id',op,'action','cancel');
  begin
    perform public.billing_request_live_scheduled_cancellation_v1(project,account,req);
    raise exception 'Default-off cancellation admitted a request';
  exception when object_not_in_prerequisite_state then
    if sqlerrm<>'billing_scheduled_cancellation_unavailable' then raise; end if;
  end;
  update private.stripe_billing_settings set live_scheduled_plan_change_admission_enabled=true,
    live_scheduled_plan_change_provider_writes_enabled=true,live_scheduled_closeout_enabled=true where singleton;
  if public.billing_live_scheduled_customer_ready_v1(project,account) then
    raise exception 'New scheduling ignored disabled cancellation'; end if;
  begin
    perform public.billing_confirm_live_scheduled_plan_change_v1(project,account,
      jsonb_build_object('subject_user_id',cycle.subject_id,'operation_id',gen_random_uuid()));
    raise exception 'Disabled cancellation allowed a new live confirmation';
  exception when object_not_in_prerequisite_state then
    if sqlerrm<>'billing_live_scheduled_change_admission_unavailable' then raise; end if;
  end;
  update private.stripe_billing_settings set live_scheduled_cancellation_admission_enabled=true,
    live_scheduled_cancellation_provider_writes_enabled=true where singleton;
  if not public.billing_live_scheduled_customer_ready_v1(project,account)
    or public.billing_live_scheduled_customer_ready_v1(project,'acct_Foreign325') then raise exception 'Customer readiness is not pinned'; end if;
  if public.billing_request_live_scheduled_cancellation_v1(project,account,req||jsonb_build_object('subject_user_id',install.subject_id)) is not null then
    raise exception 'Different teacher requested cancellation'; end if;
  select jsonb_build_object('paid_through',paid_through,'access_ends_at',access_ends_at,'invoice',last_paid_invoice_id,
    'plan_revision',account_plan_revision,'entitlement_revision',entitlement_revision) into strict unchanged
    from public.billing_account_access where subject_user_id=cycle.subject_id;
  if public.billing_request_live_scheduled_cancellation_v1(project,account,req)->>'state' is distinct from 'cancel_pending' then
    raise exception 'Cancellation request was not durable'; end if;
  if not private.billing_live_reconciliation_blocked_v1(cycle.subscription_id)
    or public.billing_list_live_scheduled_cancellations_v1(project,account,'{"limit":5}') is distinct from jsonb_build_array(op) then
    raise exception 'Cancellation does not own reconciliation or recovery discovery'; end if;
  c:=pg_temp.cancel_command_325(op,'claim'); f:=c->'fence';
  if c#>>'{operation,operationId}' is distinct from cycle.schedule_id::text
    or c#>>'{operation,lastPaidInvoiceId}' is distinct from cycle.invoice_id
    or c#>>'{fence,operationId}' is distinct from op::text
    or c#>>'{binding,provider_mode}' is distinct from 'live' then raise exception 'Cancellation lost source and operation custody'; end if;
  if public.billing_finish_live_lifecycle_v1(project,account,jsonb_build_object('subscription_id',cycle.subscription_id))->>'status'
    is distinct from 'rejected' then raise exception 'Ordinary lifecycle accepted cancellation-owned binding'; end if;
  update private.stripe_billing_settings set live_scheduled_cancellation_provider_writes_enabled=false where singleton;
  if pg_temp.cancel_command_325(op,'authorize_write',f) is not null then raise exception 'Paused provider write authorized'; end if;
  update private.stripe_billing_settings set live_scheduled_cancellation_provider_writes_enabled=true where singleton;
  c:=pg_temp.cancel_command_325(op,'authorize_write',f);
  if c is null or pg_temp.cancel_command_325(op,'finish',f,'canceled') is not null then
    raise exception 'Write-ahead checkpoint did not reject stale operation revision'; end if;
  update private.stripe_billing_settings set live_scheduled_cancellation_provider_writes_enabled=false where singleton;
  if pg_temp.cancel_command_325(op,'finish',c->'fence','attention') is distinct from 'true'::jsonb then
    raise exception 'Could not persist attention after an authorized possible write'; end if;
  if not exists(select 1 from private.billing_live_scheduled_cancellations where id=op and state='attention'
    and next_attempt_at>clock_timestamp()+interval '14 minutes')
    or pg_temp.cancel_command_325(op,'claim') is not null
    or public.billing_list_live_scheduled_cancellations_v1(project,account,'{"limit":5}') is distinct from '[]'::jsonb then
    raise exception 'Attention ignored its per-operation read-only cooldown'; end if;
  update private.billing_live_scheduled_cancellations set next_attempt_at=clock_timestamp()-interval '1 second' where id=op;
  if public.billing_list_live_scheduled_cancellations_v1(project,account,'{"limit":5}') is distinct from jsonb_build_array(op) then
    raise exception 'Authorized attention was lost from read-only recovery'; end if;
  c:=pg_temp.cancel_command_325(op,'claim');
  update private.stripe_billing_settings set live_scheduled_cancellation_provider_writes_enabled=true where singleton;
  if c->'readOnly' is distinct from 'true'::jsonb
    or pg_temp.cancel_command_325(op,'authorize_write',c->'fence') is not null then
    raise exception 'Attention worker acquired provider write authority'; end if;
  update private.stripe_billing_settings set live_scheduled_cancellation_provider_writes_enabled=false where singleton;
  if pg_temp.cancel_command_325(op,'finish',c->'fence','canceled') is distinct from 'true'::jsonb then
    raise exception 'Paused attention could not store the exact recovered provider result'; end if;
  r:=public.billing_get_live_scheduled_cancellation_v1(project,account,jsonb_build_object('subject_user_id',cycle.subject_id));
  if r->>'state' is distinct from 'cancel_scheduled' or r->'canUndo' is distinct from 'false'::jsonb
    or not exists(select 1 from public.billing_account_access where subject_user_id=cycle.subject_id and end_reason='cancellation'
      and paid_through=cycle.effective_at and access_ends_at=cycle.effective_at and last_paid_invoice_id=cycle.invoice_id)
    or public.billing_list_live_scheduled_cancellations_v1(project,account,'{"limit":5}') is distinct from '[]'::jsonb then
    raise exception 'Verified pre-boundary cancellation did not retain the Max term until exact cutoff'; end if;
  update private.stripe_billing_settings set live_scheduled_cancellation_provider_writes_enabled=true where singleton;
  if public.billing_request_live_scheduled_cancellation_v1(project,account,req||jsonb_build_object('action','undo','operation_id',fresh_op)) is not null then
    raise exception 'Undo used a different cancellation marker'; end if;
  if public.billing_request_live_scheduled_cancellation_v1(project,account,req||'{"action":"undo"}')->>'state' is distinct from 'undo_pending' then
    raise exception 'Original cancellation marker did not admit undo'; end if;
  c:=pg_temp.cancel_command_325(op,'claim');
  if c->>'action' is distinct from 'undo' or c->>'cancellationOperationId' is distinct from op::text then raise exception 'Undo marker changed'; end if;
  c:=pg_temp.cancel_command_325(op,'authorize_write',c->'fence');
  if pg_temp.cancel_command_325(op,'finish',c->'fence','restored') is distinct from 'true'::jsonb then raise exception 'Undo did not settle'; end if;
  if private.billing_live_reconciliation_blocked_v1(cycle.subscription_id)
    or (select jsonb_build_object('paid_through',paid_through,'access_ends_at',access_ends_at,'invoice',last_paid_invoice_id,
      'plan_revision',account_plan_revision,'entitlement_revision',entitlement_revision)
      from public.billing_account_access where subject_user_id=cycle.subject_id and end_reason='renewal_pending') is distinct from unchanged then
    raise exception 'Undo changed paid term/revisions or retained reconciliation ownership'; end if;

  -- Model elapsed durable intents. Only the authorized lost-response intent
  -- may complete against exact independent terminal evidence.
  insert into private.billing_live_scheduled_cancellations(id,schedule_operation_id,subscription_id,state,requested_action,
    action_requested_at,write_authorized_at,next_attempt_at) values
    (completed_op,complete.schedule_id,complete.subscription_id,'cancel_pending','cancel',complete.effective_at-interval '1 hour',
      complete.effective_at-interval '30 minutes',complete.effective_at),
    (pristine_op,pristine.schedule_id,pristine.subscription_id,'cancel_pending','cancel',pristine.effective_at-interval '1 hour',
      null,pristine.effective_at);
  if private.billing_live_reconciliation_blocked_v1(pristine.subscription_id) then
    raise exception 'Pristine elapsed cancellation blocked untouched Pro renewal'; end if;
  r:=pg_temp.cancel_command_325(pristine_op,'claim');
  if r is not null
    or not exists(select 1 from private.billing_live_scheduled_cancellations where id=pristine_op and state='abandoned') then
    raise exception 'Pristine elapsed cancellation was not abandoned without provider work'; end if;
  update private.stripe_billing_settings set live_scheduled_cancellation_admission_enabled=false,
    live_scheduled_cancellation_provider_writes_enabled=false where singleton;
  c:=pg_temp.cancel_command_325(completed_op,'claim'); f:=c->'fence';
  if c is null or pg_temp.cancel_command_325(completed_op,'authorize_write',f) is not null then raise exception 'Elapsed recovery granted writes or was hidden'; end if;
  end_evidence:=jsonb_build_object('ended_at',to_char(complete.effective_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'obligations_cleared',true);
  if pg_temp.cancel_command_325(completed_op,'finish',f,'completed',end_evidence||'{"ended_at":"2000-01-01T00:00:00Z"}') is not null then
    raise exception 'Wrong provider end timestamp retired the payer'; end if;
  if pg_temp.cancel_command_325(completed_op,'finish',f,'completed',end_evidence) is distinct from 'true'::jsonb then
    raise exception 'Verified completed cancellation did not settle'; end if;
  if not exists(select 1 from private.billing_scheduled_plan_changes where id=complete.schedule_id and state='canceled')
    or not exists(select 1 from public.billing_account_access a join public.account_plans p on p.subject_user_id=a.subject_user_id
      where a.subscription_id=complete.subscription_id and a.end_reason='cancellation' and a.paid_through=complete.effective_at
        and a.access_ends_at=complete.effective_at and a.expiry_applied_at is not null and p.plan_key='free')
    or not exists(select 1 from public.stripe_billing_subscription_bindings where id=complete.subscription_id and not is_current
      and obligations_cleared_at is not null and lease_token is null)
    or (select count(*) from public.stripe_billing_invoice_effects where subscription_id=complete.subscription_id)<>1 then
    raise exception 'Scheduled cancellation created a Pro receipt/grace or failed to expire and retire'; end if;
  req:=jsonb_build_object('subject_user_id',complete.subject_id);
  r:=public.billing_get_live_scheduled_cancellation_v1(project,account,req);
  if r->>'state' is distinct from 'completed' or r->>'scheduleOperationId' is distinct from complete.schedule_id::text
    or r->>'cancellationOperationId' is distinct from completed_op::text
    or (r->>'effectiveAt')::timestamptz is distinct from complete.effective_at
    or r->'canCancel' is distinct from 'false'::jsonb or r->'canUndo' is distinct from 'false'::jsonb then
    raise exception 'Completed cancellation lost the exact historical status'; end if;
  insert into public.stripe_billing_subscription_bindings(subject_user_id,stripe_account,provider_mode,
    stripe_customer_id,stripe_subscription_id,offering_version_id)
    select subject_user_id,stripe_account,provider_mode,stripe_customer_id,'sub_Live325NewTerm',offering_version_id
    from public.stripe_billing_subscription_bindings where id=complete.subscription_id;
  if public.billing_get_live_scheduled_cancellation_v1(project,account,req) is not null then
    raise exception 'Completed cancellation overrode a newer current subscription'; end if;
end;
$$;

-- Model an authorized Stripe write whose response was lost across the cutoff.
-- Effective access is already blocked, but uncertain undo may not restrict
-- classrooms or consume the Max plan revision before verification.
do $$
declare
  project constant text:='abcdefghijklmnopqrst'; account constant text:='acct_Live325';
  late live_cancel_325%rowtype; unchanged live_cancel_325%rowtype; undo_terminal live_cancel_325%rowtype;
  change private.billing_scheduled_plan_changes%rowtype;
  undo_id uuid:=gen_random_uuid(); cancel_id uuid:=gen_random_uuid(); terminal_id uuid:=gen_random_uuid();
  c jsonb; f jsonb; r jsonb; evidence jsonb; payment jsonb;
  target_end timestamptz; original_plan_revision bigint; original_entitlement_revision bigint;
begin
  select * into strict late from live_cancel_325 where kind='lateundo';
  select * into strict unchanged from live_cancel_325 where kind='unchanged';
  select * into strict undo_terminal from live_cancel_325 where kind='undoterminal';
  select * into strict change from private.billing_scheduled_plan_changes where id=late.schedule_id;
  target_end:=private.billing_scheduled_term_end_v1(late.effective_at,change.target_offering_version_id);
  update public.billing_account_access set end_reason='cancellation',revision=revision+1 where subscription_id=late.subscription_id
    returning account_plan_revision,entitlement_revision into original_plan_revision,original_entitlement_revision;
  insert into private.billing_live_scheduled_cancellations(id,schedule_operation_id,subscription_id,state,requested_action,
    action_requested_at,write_authorized_at,next_attempt_at) values
    (undo_id,late.schedule_id,late.subscription_id,'attention','undo',late.effective_at-interval '1 hour',
      late.effective_at-interval '30 minutes',late.effective_at),
    (cancel_id,unchanged.schedule_id,unchanged.subscription_id,'cancel_pending','cancel',unchanged.effective_at-interval '1 hour',
      unchanged.effective_at-interval '30 minutes',unchanged.effective_at);
  r:=public.billing_get_live_access_status_v1(project,account,jsonb_build_object('subject_user_id',late.subject_id));
  if r->>'state' is distinct from 'free' or r->'can_start_paid_work' is distinct from 'false'::jsonb then
    raise exception 'Authorized undo extended access beyond the exact cutoff'; end if;
  r:=public.billing_apply_due_live_paid_access_v1(project,account,'{"limit":10}');
  if r->>'processed' is distinct from '0'
    or not exists(select 1 from public.billing_account_access where subscription_id=late.subscription_id
      and expiry_applied_at is null and account_plan_revision=original_plan_revision
      and entitlement_revision=original_entitlement_revision) then
    raise exception 'Expiry materialized before resolving a possibly successful undo'; end if;

  c:=pg_temp.cancel_command_325(undo_id,'claim'); f:=c->'fence';
  evidence:=jsonb_build_object('provider_schedule_id',change.provider_schedule_id,
    'period_start',to_char(late.effective_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'period_end',to_char(target_end at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  if c->'readOnly' is distinct from 'true'::jsonb or pg_temp.cancel_command_325(undo_id,'authorize_write',f) is not null
    or pg_temp.cancel_command_325(undo_id,'finish',f,'restored') is not null
    or pg_temp.cancel_command_325(undo_id,'finish',f||jsonb_build_object('leaseToken',gen_random_uuid()),'restored_after_cutoff',evidence) is not null
    or pg_temp.cancel_command_325(undo_id,'finish',f,'restored_after_cutoff',evidence||'{"provider_schedule_id":"sub_sched_Wrong325"}') is not null then
    raise exception 'Late undo accepted writes, stale fencing, or mismatched schedule'; end if;
  if pg_temp.cancel_command_325(undo_id,'finish',f,'restored_after_cutoff',evidence) is distinct from 'true'::jsonb then
    raise exception 'Verified exact late undo did not hand off'; end if;
  if private.billing_live_reconciliation_blocked_v1(late.subscription_id)
    or not exists(select 1 from private.billing_live_scheduled_cancellations where id=undo_id and state='undone'
      and late_undo_handoff_at>=late.effective_at)
    or not exists(select 1 from public.billing_account_access where subscription_id=late.subscription_id
      and end_reason='renewal_pending' and access_ends_at=late.effective_at and last_paid_invoice_id=late.invoice_id
      and account_plan_revision=original_plan_revision and entitlement_revision=original_entitlement_revision)
    or (select count(*) from public.stripe_billing_invoice_effects where subscription_id=late.subscription_id)<>1 then
    raise exception 'Undo handoff altered the Max term or applied unverified Pro payment'; end if;

  payment:=jsonb_build_object('subscription_id',late.subscription_id,'operation_id',change.id,'provider_schedule_id',change.provider_schedule_id,
    'target_offering_version_id',change.target_offering_version_id,'provider_status','active','cancel_at_period_end',false,
    'obligations_cleared',false,'invoice_id','in_Pro325lateundo','period_start',late.effective_at,'period_end',target_end);
  c:=public.billing_claim_live_subscription_v1(project,account,jsonb_build_object('subscription_id',late.subscription_id,'lease_seconds',120));
  r:=public.billing_finish_live_scheduled_renewal_v1(project,account,payment||jsonb_build_object(
    'lease_token',c->'lease_token','fencing_token',c->'fencing_token','expected_subscription_revision',c->'subscription_revision',
    'expected_account_plan_revision',c->'expected_account_plan_revision','outcome','renewal_invoice_pending'));
  if r->>'status' is distinct from 'deferred'
    or (select count(*) from public.stripe_billing_invoice_effects where subscription_id=late.subscription_id)<>1 then
    raise exception 'Ordinary scheduled path could not wait without granting Pro'; end if;
  update public.stripe_billing_subscription_bindings set next_reconcile_at=clock_timestamp()-interval '1 second' where id=late.subscription_id;
  c:=public.billing_claim_live_subscription_v1(project,account,jsonb_build_object('subscription_id',late.subscription_id,'lease_seconds',120));
  r:=public.billing_finish_live_scheduled_renewal_v1(project,account,payment||jsonb_build_object(
    'lease_token',c->'lease_token','fencing_token',c->'fencing_token','expected_subscription_revision',c->'subscription_revision',
    'expected_account_plan_revision',c->'expected_account_plan_revision','outcome','paid'));
  if r->>'status' is distinct from 'applied'
    or not exists(select 1 from private.billing_scheduled_plan_changes where id=late.schedule_id
      and state='applied' and live_settled_invoice_id='in_Pro325lateundo')
    or (select count(*) from public.stripe_billing_invoice_effects where subscription_id=late.subscription_id)<>2 then
    raise exception 'Ordinary scheduled path could not apply independently verified Pro'; end if;

  select * into strict change from private.billing_scheduled_plan_changes where id=unchanged.schedule_id;
  target_end:=private.billing_scheduled_term_end_v1(unchanged.effective_at,change.target_offering_version_id);
  evidence:=jsonb_build_object('provider_schedule_id',change.provider_schedule_id,
    'period_start',to_char(unchanged.effective_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'period_end',to_char(target_end at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  c:=pg_temp.cancel_command_325(cancel_id,'claim');
  if pg_temp.cancel_command_325(cancel_id,'finish',c->'fence','unchanged_after_cutoff',evidence) is distinct from 'true'::jsonb then
    raise exception 'Verified unchanged schedule did not release an ambiguous cancel'; end if;
  if private.billing_live_reconciliation_blocked_v1(unchanged.subscription_id)
    or not exists(select 1 from private.billing_live_scheduled_cancellations where id=cancel_id and state='abandoned')
    or not exists(select 1 from public.billing_account_access where subscription_id=unchanged.subscription_id
      and end_reason='renewal_pending' and access_ends_at=unchanged.effective_at and last_paid_invoice_id=unchanged.invoice_id) then
    raise exception 'Unchanged schedule handoff did not preserve original financial custody'; end if;

  -- An undo with no write authorization still owns a verified prior cancel.
  update public.billing_account_access set end_reason='cancellation',revision=revision+1 where subscription_id=undo_terminal.subscription_id;
  insert into private.billing_live_scheduled_cancellations(id,schedule_operation_id,subscription_id,state,requested_action,
    action_requested_at,write_authorized_at,next_attempt_at) values
    (terminal_id,undo_terminal.schedule_id,undo_terminal.subscription_id,'attention','undo',
      undo_terminal.effective_at-interval '1 hour',null,undo_terminal.effective_at);
  c:=pg_temp.cancel_command_325(terminal_id,'claim');
  if c->'readOnly' is distinct from 'true'::jsonb then raise exception 'Verified prior cancellation was not recoverable'; end if;
  evidence:=jsonb_build_object('ended_at',to_char(undo_terminal.effective_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'obligations_cleared',true);
  if pg_temp.cancel_command_325(terminal_id,'finish',c->'fence','completed',evidence) is distinct from 'true'::jsonb then
    raise exception 'Read-only undo attention could not finish its verified prior cancel'; end if;
  if not exists(select 1 from public.stripe_billing_subscription_bindings where id=undo_terminal.subscription_id
    and not is_current and obligations_cleared_at is not null) then
    raise exception 'Read-only undo attention did not retire its canceled payer'; end if;
end;
$$;

rollback;
