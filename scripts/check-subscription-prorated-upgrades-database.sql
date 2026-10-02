-- Fixtures first: rollback-only database contracts, no provider calls.
-- Execute only after separately authorized migration 230 application.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$ declare fn text; begin
  foreach fn in array array['billing_reserve_upgrade_v1','billing_get_upgrade_v1','billing_claim_upgrade_v1',
    'billing_list_upgrades_v1','billing_checkpoint_upgrade_v1','billing_confirm_upgrade_v1','billing_finish_upgrade_v1',
    'billing_get_applied_upgrade_v1'] loop
    if has_function_privilege('anon','public.'||fn||'(jsonb)','execute')
      or has_function_privilege('authenticated','public.'||fn||'(jsonb)','execute')
      or not has_function_privilege('service_role','public.'||fn||'(jsonb)','execute') then raise exception 'Upgrade RPC ACL: %',fn; end if;
  end loop;
  foreach fn in array array['billing_upgrade_operations','billing_upgrade_receipts'] loop
    if has_table_privilege('anon','public.'||fn,'select') or has_table_privilege('authenticated','public.'||fn,'select')
      or has_table_privilege('service_role','public.'||fn,'update') or has_table_privilege('service_role','public.'||fn,'insert')
      or not (select relrowsecurity from pg_class where oid=('public.'||fn)::regclass) then raise exception 'Upgrade table ACL: %',fn; end if;
  end loop;
end $$;
update private.stripe_billing_settings set sandbox_enabled=false where singleton;
set local role service_role;
do $$ begin
  begin perform public.billing_list_upgrades_v1('{"limit":1}'); raise exception 'Disabled upgrade gate accepted';
  exception when object_not_in_prerequisite_state then if sqlerrm<>'stripe_billing_sandbox_disabled' then raise; end if; end;
end $$;
reset role;
update private.stripe_billing_settings set sandbox_enabled=true where singleton;
create temporary table upgrade_cases(name text primary key,subject_id uuid,subscription_id uuid,source_id uuid,target_id uuid,operation_id uuid);
grant select on upgrade_cases to service_role;
create temporary table upgrade_saved(name text primary key,claim jsonb);
grant all on upgrade_saved to service_role;
create function pg_temp.upgrade_fence(c jsonb) returns jsonb language sql immutable as $$
  select jsonb_build_object('operation_id',c#>>'{operation,operation_id}','subscription_id',c#>>'{operation,subscription_id}',
    'lease_token',c->>'lease_token','fencing_token',c->'fencing_token','subscription_revision',c->'subscription_revision',
    'expected_account_plan_revision',c->'expected_account_plan_revision','expected_access_revision',c->'expected_access_revision',
    'expected_entitlement_revision',c->'expected_entitlement_revision','operation_revision',c#>'{operation,revision}');
$$;
do $$ declare src jsonb; dst jsonb; b jsonb; c jsonb; r jsonb; u uuid; n text; t timestamptz:=date_trunc('second',clock_timestamp()); begin
  src:=public.billing_register_offering_v1(jsonb_build_object('plan_key','basic','version',9230,'stripe_account','acct_upgrade230',
    'provider_mode','test','stripe_product_id','prod_upgrade230basic','stripe_price_id','price_upgrade230basic','currency','usd',
    'unit_amount',900,'interval','month','classroom_limit',2,'features','{"catalog_key":"upgrade230-basic"}'::jsonb,
    'ai_definition',null,'availability','{"is_available":true}'::jsonb));
  dst:=public.billing_register_offering_v1(jsonb_build_object('plan_key','plus','version',9230,'stripe_account','acct_upgrade230',
    'provider_mode','test','stripe_product_id','prod_upgrade230plus','stripe_price_id','price_upgrade230plus','currency','usd',
    'unit_amount',1900,'interval','month','classroom_limit',5,'features','{"catalog_key":"upgrade230-plus"}'::jsonb,
    'ai_definition',null,'availability','{"is_available":true}'::jsonb));
  foreach n in array array['applied','lease','override','entitlement','access','expiry','attention','unpaid','cancel','queue','zero','retry'] loop
    u:=gen_random_uuid(); insert into public.users(id,email,role) values(u,'upgrade230-'||n||'@example.invalid','teacher');
    if not exists(select 1 from public.account_plans where subject_user_id=u) then
      perform public.set_account_plan_v1(gen_random_uuid(),u,'free','test:upgrade','fixture',0); end if;
    b:=public.billing_bind_customer_v1(jsonb_build_object('subject_user_id',u,'stripe_account','acct_upgrade230','provider_mode','test',
      'stripe_price_id','price_upgrade230basic','stripe_customer_id','cus_upgrade230'||n,'stripe_subscription_id','sub_upgrade230'||n,
      'offering_version_id',src->>'offering_version_id'));
    c:=public.billing_claim_subscription_v1(jsonb_build_object('subscription_id',b->>'subscription_id','lease_seconds',120));
    r:=public.billing_finish_lifecycle_v1(jsonb_build_object('subscription_id',b->>'subscription_id','lease_token',c->>'lease_token',
      'fencing_token',c->'fencing_token','expected_subscription_revision',c->'subscription_revision',
      'expected_account_plan_revision',c->'expected_account_plan_revision','outcome','paid','invoice_id','in_upgrade230'||n,
      'period_start',t-interval '15 days','period_end',t+interval '15 days','provider_status','active',
      'cancel_at_period_end',false,'obligations_cleared',false));
    if r->>'status'<>'applied' then raise exception 'Upgrade fixture payment: %',r; end if;
    insert into upgrade_cases values(n,u,(b->>'subscription_id')::uuid,(src->>'offering_version_id')::uuid,
      (dst->>'offering_version_id')::uuid,gen_random_uuid());
  end loop;
end $$;
-- Currency/interval and same-tier changes cannot masquerade as upgrades.
do $$ declare f record; v jsonb; kind text; n integer:=9231; begin
  select * into f from upgrade_cases where name='queue';
  foreach kind in array array['currency','interval','tier'] loop
    v:=public.billing_register_offering_v1(jsonb_build_object('plan_key',case when kind='tier' then 'basic' else 'plus' end,
      'version',n,'stripe_account','acct_upgrade230','provider_mode','test','stripe_product_id','prod_upgrade230'||kind,
      'stripe_price_id','price_upgrade230'||kind,'currency',case when kind='currency' then 'cad' else 'usd' end,
      'unit_amount',2900,'interval',case when kind='interval' then 'year' else 'month' end,'classroom_limit',5,
      'features',jsonb_build_object('catalog_key','upgrade230-'||kind),'ai_definition',null,'availability','{"is_available":true}'::jsonb));
    if public.billing_reserve_upgrade_v1(jsonb_build_object('subject_user_id',f.subject_id,'operation_id',gen_random_uuid(),
      'offering_version_id',v->>'offering_version_id'))->>'status'<>'plan_conflict' then raise exception 'Unsupported upgrade: %',kind; end if;
    n:=n+1;
  end loop;
end $$;
-- Strict public boundary before any lookup.
set local role service_role;
do $$ declare r jsonb; k text; base jsonb:=jsonb_build_object('subject_user_id',gen_random_uuid(),'operation_id',gen_random_uuid(),'offering_version_id',gen_random_uuid()); begin
  foreach k in array array['subject_user_id','operation_id','offering_version_id'] loop
    foreach r in array array[base-k,jsonb_set(base,array[k],'null'),jsonb_set(base,array[k],'1')] loop
      begin perform public.billing_reserve_upgrade_v1(r); raise exception 'Invalid reserve accepted';
      exception when invalid_parameter_value then null; end;
    end loop;
  end loop;
  begin perform public.billing_reserve_upgrade_v1(base||'{"amount":1}'); raise exception 'Client amount accepted';
  exception when invalid_parameter_value then null; end;
  begin perform public.billing_list_upgrades_v1('{"limit":2}'); raise exception 'Unbounded upgrade work accepted';
  exception when invalid_parameter_value then null; end;
end $$;
reset role;
-- Existing unpaid or cancellation periods cannot generate earned credit.
update public.billing_account_access set end_reason='cancellation' where subject_user_id=(select subject_id from upgrade_cases where name='cancel');
update public.billing_account_access set failed_renewal_invoice_id='in_unpaid230' where subject_user_id=(select subject_id from upgrade_cases where name='unpaid');
set local role service_role;
do $$ declare f record; r jsonb; begin
  for f in select * from upgrade_cases loop
    r:=public.billing_reserve_upgrade_v1(jsonb_build_object('subject_user_id',f.subject_id,'operation_id',f.operation_id,'offering_version_id',f.target_id));
    if f.name in ('cancel','unpaid') then
      if r->>'status'<>'plan_conflict' then raise exception 'Unearned upgrade credit allowed: %',f.name; end if;
    else
      if r->>'status'<>'reserved' then raise exception 'Reserve failed: %',r; end if;
      if public.billing_get_upgrade_v1(jsonb_build_object('subject_user_id',gen_random_uuid(),'operation_id',f.operation_id))->>'status'<>'not_found' then raise exception 'Cross subject read'; end if;
      if public.billing_claim_subscription_v1(jsonb_build_object('subscription_id',f.subscription_id,'lease_seconds',120))->>'status'<>'busy' then raise exception 'Ordinary worker stole upgrade'; end if;
      r:=public.billing_claim_upgrade_v1(jsonb_build_object('operation_id',f.operation_id,'lease_seconds',120));
      if r->>'status'<>'claimed' then raise exception 'Claim failed: %',r; end if;
      insert into upgrade_saved values(f.name,r);
    end if;
  end loop;
end $$;
reset role;

-- Publishing state cannot rewrite a reserved immutable target.
update public.stripe_billing_offering_availability set is_available=false where offering_version_id=(select target_id from upgrade_cases where name='applied');
set local role service_role;
do $$ declare c jsonb; old jsonb; q jsonb; o jsonb; r jsonb; t timestamptz:=date_trunc('second',clock_timestamp());
  stage text; evidence jsonb; saved_period timestamptz; saved_start timestamptz; saved_invoice text; begin
  select claim into c from upgrade_saved where name='applied'; o:=c->'operation';
  saved_period:=(o->>'paid_through')::timestamptz; saved_start:=(o->>'paid_period_start')::timestamptz; saved_invoice:=o->>'last_paid_invoice_id';
  q:=jsonb_build_object('binding',o->'source_binding','target',o->'target','subscriptionItemId','si_upgrade230',
    'prorationDate',extract(epoch from t)::bigint,'quotedAt',t,'paidPeriodStart',o->>'paid_period_start',
    'paidThrough',o->>'paid_through','expiresAt',t+interval '15 minutes','unusedCreditAmount',-450,
    'remainingChargeAmount',950,'amountDue',500,'currency','usd','nextRecurringAmount',1900,'paymentState','payment_required',
    'lines',jsonb_build_array(jsonb_build_object('kind','old_credit','priceId','price_upgrade230basic',
      'subscriptionItemId','si_upgrade230','amount',-450,'quantity',1,'periodStart',t,'periodEnd',o->>'paid_through'),
      jsonb_build_object('kind','target_debit','priceId','price_upgrade230plus','subscriptionItemId','si_upgrade230',
      'amount',950,'quantity',1,'periodStart',t,'periodEnd',o->>'paid_through')));
  begin perform public.billing_checkpoint_upgrade_v1(pg_temp.upgrade_fence(c)||jsonb_build_object('stage','preview_verified',
    'quote',jsonb_set(q,'{target,unit_amount}','9999'),'quote_digest',repeat('a',64))); raise exception 'Quote target mismatch accepted';
  exception when invalid_parameter_value then null; end;
  old:=c;
  c:=public.billing_checkpoint_upgrade_v1(pg_temp.upgrade_fence(c)||jsonb_build_object('stage','preview_verified','quote',q,'quote_digest',repeat('a',64)));
  if c->>'status'<>'claimed' then raise exception 'Valid quote rejected: %',c; end if;
  if public.billing_checkpoint_upgrade_v1(pg_temp.upgrade_fence(old)||jsonb_build_object('stage','preview_verified','quote',q,'quote_digest',repeat('a',64)))->>'status'<>'lost_claim' then
    raise exception 'Stale operation revision accepted'; end if;
  c:=public.billing_checkpoint_upgrade_v1(pg_temp.upgrade_fence(c)||'{"stage":"invoice_requested"}');
  c:=public.billing_checkpoint_upgrade_v1(pg_temp.upgrade_fence(c)||'{"stage":"invoice_created","invoice_id":"in_upgrade230delta"}');
  begin perform public.billing_checkpoint_upgrade_v1(pg_temp.upgrade_fence(c)||'{"stage":"invoice_created","invoice_id":"in_upgrade230different"}');
    raise exception 'Invoice identity changed'; exception when invalid_parameter_value then null; end;
  c:=public.billing_checkpoint_upgrade_v1(pg_temp.upgrade_fence(c)||'{"stage":"finalize_requested"}');
  c:=public.billing_checkpoint_upgrade_v1(pg_temp.upgrade_fence(c)||jsonb_build_object('stage','quoted','quote',q,'quote_digest',repeat('b',64)));
  o:=c->'operation';
  r:=public.billing_finish_upgrade_v1(pg_temp.upgrade_fence(c)||'{"outcome":"awaiting_confirmation"}');
  if r->>'status'<>'awaiting_confirmation' then raise exception 'Quote wait failed'; end if;
  if public.billing_claim_upgrade_v1(jsonb_build_object('operation_id',o->>'operation_id','lease_seconds',120))->>'status'<>'busy' then raise exception 'Unconfirmed quote busy loop'; end if;
  if public.billing_confirm_upgrade_v1(jsonb_build_object('subject_user_id',o->>'subject_user_id','operation_id',o->>'operation_id',
    'quote_revision',o->'quote_revision','quote_digest',repeat('a',64)))->>'status'<>'rejected' then raise exception 'Old quote digest accepted'; end if;
  r:=public.billing_confirm_upgrade_v1(jsonb_build_object('subject_user_id',o->>'subject_user_id','operation_id',o->>'operation_id',
    'quote_revision',o->'quote_revision','quote_digest',o->>'quote_digest'));
  if r->>'status'<>'confirmed' then raise exception 'Confirmation failed: %',r; end if;
  if public.billing_confirm_upgrade_v1(jsonb_build_object('subject_user_id',o->>'subject_user_id','operation_id',o->>'operation_id',
    'quote_revision',o->'quote_revision','quote_digest',o->>'quote_digest'))->>'status'<>'existing' then raise exception 'Duplicate confirmation changed operation'; end if;
  c:=public.billing_claim_upgrade_v1(jsonb_build_object('operation_id',o->>'operation_id','lease_seconds',120));
  if c->>'status'<>'claimed' then raise exception 'Confirmed quote not claimable: %',c; end if;
  begin perform public.billing_checkpoint_upgrade_v1(pg_temp.upgrade_fence(c)||jsonb_build_object('stage','quoted','quote',q,'quote_digest',repeat('c',64)));
    raise exception 'Confirmed quote mutated'; exception when invalid_parameter_value then null; end;
  c:=public.billing_checkpoint_upgrade_v1(pg_temp.upgrade_fence(c)||'{"stage":"payment_requested"}');
  c:=public.billing_checkpoint_upgrade_v1(pg_temp.upgrade_fence(c)||'{"stage":"payment_verified","payment_intent_id":"pi_upgrade230"}');
  c:=public.billing_checkpoint_upgrade_v1(pg_temp.upgrade_fence(c)||'{"stage":"change_requested"}');
  evidence:=jsonb_build_object('invoiceId','in_upgrade230delta','paymentIntentId','pi_upgrade230','subscriptionId',o#>>'{source_binding,stripe_subscription_id}',
    'paymentState','paid','providerStatus','active','amountPaid',500,'currency','usd','subscriptionItemId','si_upgrade230',
    'targetPriceId','price_upgrade230plus','paidPeriodStart',o->>'paid_period_start','paidThrough',o->>'paid_through');
  begin perform public.billing_finish_upgrade_v1(pg_temp.upgrade_fence(c)||jsonb_build_object('outcome','applied','evidence',evidence||'{"amountPaid":499}'));
    raise exception 'Partial upgrade payment accepted'; exception when invalid_parameter_value then null; end;
  r:=public.billing_finish_upgrade_v1(pg_temp.upgrade_fence(c)||jsonb_build_object('outcome','applied','evidence',evidence));
  if r->>'status'<>'applied' then raise exception 'Verified upgrade failed: %',r; end if;
  if public.billing_finish_upgrade_v1(pg_temp.upgrade_fence(c)||jsonb_build_object('outcome','applied','evidence',evidence))->>'status'<>'lost_claim' then raise exception 'Finish replay reused lease'; end if;
  if not exists(select 1 from public.billing_account_access where subject_user_id=(o->>'subject_user_id')::uuid
    and offering_version_id=(o#>>'{target,offering_version_id}')::uuid and paid_through=saved_period
    and paid_period_start=saved_start and access_ends_at=saved_period and last_paid_invoice_id=saved_invoice
    and account_plan_revision>(c->>'expected_account_plan_revision')::bigint) then raise exception 'Same-period upgrade failed or dates extended'; end if;
  if not exists(select 1 from public.effective_feature_entitlements where subject_user_id=(o->>'subject_user_id')::uuid
    and feature_key='classrooms.create' and quota_limit=5) then raise exception 'Versioned benefits were not rewritten'; end if;
  if not exists(select 1 from public.stripe_billing_invoice_effects where subscription_id=(o->>'subscription_id')::uuid
    and stripe_invoice_id=saved_invoice and offering_version_id=(o#>>'{source_binding,offering_version_id}')::uuid)
    or exists(select 1 from public.stripe_billing_invoice_effects where stripe_invoice_id='in_upgrade230delta')
    or (select count(*) from public.billing_upgrade_receipts where operation_id=(o->>'operation_id')::uuid)<>1 then raise exception 'Purchase history forged or lost'; end if;
  if public.billing_get_applied_upgrade_v1(jsonb_build_object('subscription_id',o->>'subscription_id'))#>>'{operation,status}'<>'applied' then raise exception 'Applied receipt unavailable'; end if;
end $$;
reset role;
-- Every revision and expired lease is independently fenced; overrides never refresh.
update public.stripe_billing_subscription_bindings set lease_expires_at=clock_timestamp()-interval '1 second'
  where id=(select subscription_id from upgrade_cases where name='lease');
update public.account_plans set revision=revision+1 where subject_user_id=(select subject_id from upgrade_cases where name='override');
update public.effective_feature_entitlements set revision=revision+1 where subject_user_id=(select subject_id from upgrade_cases where name='entitlement') and feature_key='classrooms.create';
update public.billing_account_access set revision=revision+1 where subject_user_id=(select subject_id from upgrade_cases where name='access');
update public.billing_upgrade_operations set expires_at=clock_timestamp()-interval '1 second' where id=(select operation_id from upgrade_cases where name='expiry');
set local role service_role;
do $$ declare f record; c jsonb; r jsonb; begin
  for f in select * from upgrade_saved where name in ('lease','override','entitlement','access') loop
    r:=public.billing_finish_upgrade_v1(pg_temp.upgrade_fence(f.claim)||'{"outcome":"deferred"}');
    if r->>'status'<>case when f.name='lease' then 'lost_claim' else 'plan_conflict' end then raise exception 'Fence failed: % %',f.name,r; end if;
  end loop;
  select claim into c from upgrade_saved where name='lease';
  r:=public.billing_claim_upgrade_v1(jsonb_build_object('operation_id',c#>>'{operation,operation_id}','lease_seconds',120));
  if r->>'status'<>'claimed' or (r->>'fencing_token')::bigint<=(c->>'fencing_token')::bigint then raise exception 'Reclaim did not fence'; end if;
  select claim into c from upgrade_saved where name='expiry';
  if public.billing_finish_upgrade_v1(pg_temp.upgrade_fence(c)||'{"outcome":"expired"}')->>'status'<>'expired' then raise exception 'Safe pre-invoice expiry failed'; end if;
  select claim into c from upgrade_saved where name='attention';
  r:=public.billing_finish_upgrade_v1(pg_temp.upgrade_fence(c)||'{"outcome":"attention","reason":"provider_unknown"}');
  if r->>'status'<>'attention' then raise exception 'Attention failed'; end if;
  if public.billing_reserve_upgrade_v1(jsonb_build_object('subject_user_id',c#>>'{operation,subject_user_id}',
    'operation_id',gen_random_uuid(),'offering_version_id',c#>>'{operation,target,offering_version_id}'))->>'status'<>'busy' then raise exception 'Attention allowed duplicate charge'; end if;
end $$;
reset role;
-- Ineligible old rows and leased rows cannot starve the one-item queue.
update public.stripe_billing_subscription_bindings set lease_token=null,lease_expires_at=null
  where id in (select subscription_id from upgrade_cases where name in ('queue','override','entitlement','access'));
update public.billing_upgrade_operations set next_attempt_at=clock_timestamp()-interval '1 day'
  where id in(select operation_id from upgrade_cases where name in ('override','entitlement','access'));
set local role service_role;
do $$ declare r jsonb; expected uuid; begin
  select operation_id into expected from upgrade_cases where name='queue';
  r:=public.billing_list_upgrades_v1('{"limit":1}');
  if r#>>'{items,0,operation_id}' is distinct from expected::text then raise exception 'Upgrade queue starved: %',r; end if;
end $$;
reset role;
create function pg_temp.upgrade_quote(o jsonb,zero_due boolean default false) returns jsonb language plpgsql as $$
declare t timestamptz:=date_trunc('second',clock_timestamp()); debit integer:=case when zero_due then 450 else 950 end;
begin return jsonb_build_object('binding',o->'source_binding','target',o->'target','subscriptionItemId','si_upgrade230',
  'prorationDate',extract(epoch from t)::bigint,'quotedAt',t,'paidPeriodStart',o->>'paid_period_start','paidThrough',o->>'paid_through',
  'expiresAt',t+interval '15 minutes','unusedCreditAmount',-450,'remainingChargeAmount',debit,'amountDue',debit-450,
  'currency','usd','nextRecurringAmount',1900,'paymentState',case when zero_due then 'zero_due' else 'payment_required' end,
  'lines',jsonb_build_array(jsonb_build_object('kind','old_credit','priceId','price_upgrade230basic','subscriptionItemId','si_upgrade230',
  'amount',-450,'quantity',1,'periodStart',t,'periodEnd',o->>'paid_through'),jsonb_build_object('kind','target_debit',
  'priceId','price_upgrade230plus','subscriptionItemId','si_upgrade230','amount',debit,'quantity',1,'periodStart',t,'periodEnd',o->>'paid_through'))); end; $$;
-- Zero due is not successful paid evidence; expiry with an invoice needs proof.
set local role service_role;
do $$ declare c jsonb; q jsonb; o jsonb; begin
  select claim into c from upgrade_saved where name='zero'; q:=pg_temp.upgrade_quote(c->'operation',true);
  c:=public.billing_checkpoint_upgrade_v1(pg_temp.upgrade_fence(c)||jsonb_build_object('stage','preview_verified','quote',q,'quote_digest',repeat('d',64)));
  c:=public.billing_checkpoint_upgrade_v1(pg_temp.upgrade_fence(c)||'{"stage":"invoice_requested"}');
  c:=public.billing_checkpoint_upgrade_v1(pg_temp.upgrade_fence(c)||'{"stage":"invoice_created","invoice_id":"in_upgrade230zero"}');
  c:=public.billing_checkpoint_upgrade_v1(pg_temp.upgrade_fence(c)||'{"stage":"finalize_requested"}');
  c:=public.billing_checkpoint_upgrade_v1(pg_temp.upgrade_fence(c)||jsonb_build_object('stage','quoted','quote',q,'quote_digest',repeat('e',64)));
  o:=c->'operation';
  if public.billing_confirm_upgrade_v1(jsonb_build_object('subject_user_id',o->>'subject_user_id','operation_id',o->>'operation_id',
    'quote_revision',o->'quote_revision','quote_digest',o->>'quote_digest'))->>'status'<>'rejected' then raise exception 'Zero quote unlocked paid upgrade'; end if;
  update upgrade_saved set claim=c where name='zero';
end $$;
reset role;
update public.billing_upgrade_operations set expires_at=clock_timestamp()-interval '1 second' where id=(select operation_id from upgrade_cases where name='zero');
set local role service_role;
do $$ declare c jsonb; begin
  select claim into c from upgrade_saved where name='zero';
  c:=public.billing_checkpoint_upgrade_v1(pg_temp.upgrade_fence(c)||'{"stage":"void_requested"}');
  begin perform public.billing_finish_upgrade_v1(pg_temp.upgrade_fence(c)||'{"outcome":"expired"}'); raise exception 'Invoice expired without void evidence';
  exception when invalid_parameter_value then null; end;
  if public.billing_finish_upgrade_v1(pg_temp.upgrade_fence(c)||'{"outcome":"expired","evidence":{"kind":"voided","invoiceId":"in_upgrade230zero"}}')->>'status'<>'expired' then
    raise exception 'Verified void not expired'; end if;
end $$;
reset role;
-- Transport errors retain the durable mutation stage and exhaust exactly five
-- attempts. The direct due-time updates only accelerate synthetic fixture time.
do $$ declare c jsonb; q jsonb; r jsonb; i integer; begin
  select claim into c from upgrade_saved where name='retry'; q:=pg_temp.upgrade_quote(c->'operation');
  c:=public.billing_checkpoint_upgrade_v1(pg_temp.upgrade_fence(c)||jsonb_build_object('stage','preview_verified','quote',q,'quote_digest',repeat('f',64)));
  c:=public.billing_checkpoint_upgrade_v1(pg_temp.upgrade_fence(c)||'{"stage":"invoice_requested"}');
  for i in 1..5 loop
    r:=public.billing_finish_upgrade_v1(pg_temp.upgrade_fence(c)||'{"outcome":"deferred","reason":"provider_unavailable"}');
    if r->>'status'<>case when i=5 then 'attention' else 'deferred' end then raise exception 'Retry bound failed: % %',i,r; end if;
    if not exists(select 1 from public.billing_upgrade_operations where id=(c#>>'{operation,operation_id}')::uuid
      and attempt_count=i and stage='invoice_requested') then raise exception 'Retry lost write intent'; end if;
    if i<5 then
      update public.billing_upgrade_operations set next_attempt_at=clock_timestamp()-interval '1 second' where id=(c#>>'{operation,operation_id}')::uuid;
      c:=public.billing_claim_upgrade_v1(jsonb_build_object('operation_id',c#>>'{operation,operation_id}','lease_seconds',120));
      if c->>'status'<>'claimed' then raise exception 'Retry not reclaimable'; end if;
    end if;
  end loop;
end $$;
rollback;
