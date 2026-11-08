-- Rollback-only proof on an owned disposable replay through 315.
begin;
set local statement_timeout='30s';
set local lock_timeout='3s';
do $$
declare
  v_project constant text:='abcdefghijklmnopqrst';
  v_account constant text:='acct_Catalog315';
  v_request jsonb;
  v_created jsonb;
  v_duplicate jsonb;
  v_id uuid;
  v_other uuid;
  v_result jsonb;
  v_rpc text;
  v_failed boolean;
  v_terms record;
begin
  foreach v_rpc in array array[
    'public.billing_get_live_checkout_offering_v1(text,text,jsonb)',
    'public.billing_list_live_checkout_offerings_v1(text,text,jsonb)',
    'public.billing_register_live_checkout_offering_v1(text,text,jsonb)',
    'public.billing_set_live_checkout_offering_availability_v1(text,text,jsonb)'
  ] loop
    if has_function_privilege('anon',v_rpc,'execute') or has_function_privilege('authenticated',v_rpc,'execute')
      or not has_function_privilege('service_role',v_rpc,'execute') then raise exception 'Unexpected catalog privilege: %',v_rpc; end if;
  end loop;
  if has_function_privilege('service_role','private.stripe_live_checkout_offering_v1(uuid,text)','execute') then
    raise exception 'Recovery helper exposed directly';
  end if;
  for v_terms in select * from (values
    ('plus','pro','usd','month',1900::bigint,5),('plus','pro','usd','year',19900::bigint,5),
    ('plus','pro','cad','month',2700::bigint,5),('plus','pro','cad','year',27900::bigint,5),
    ('pro','max','usd','month',3900::bigint,12),('pro','max','usd','year',39900::bigint,12),
    ('pro','max','cad','month',5500::bigint,12),('pro','max','cad','year',55900::bigint,12)
  ) t(plan_key,public_plan,currency,billing_interval,amount,classroom_limit) loop
    if not private.billing_live_checkout_terms_valid_v1(v_terms.plan_key,v_terms.currency,v_terms.billing_interval,
      v_terms.amount,v_terms.classroom_limit,jsonb_build_object(
        'catalog_key','pika:repolight-2026-10-29:'||v_terms.public_plan||':'||v_terms.currency||':'||v_terms.billing_interval,
        'display_name',case v_terms.public_plan when 'pro' then 'Pro' else 'Max' end,
        'release_tag','repolight-2026-10-29','repolight_analysis',true),null) then
      raise exception 'Canonical live catalog term rejected: %',v_terms;
    end if;
  end loop;
  update private.stripe_billing_settings set live_project_ref=v_project,live_stripe_account=v_account,
    classroom_new_work_cutoff_enabled=true where singleton;
  update private.stripe_billing_settings set live_payment_lifecycle_enabled=true where singleton;
  v_request:=jsonb_build_object('plan_key','plus','version',315001,'stripe_account',v_account,'provider_mode','live',
    'stripe_product_id','prod_Catalog315','stripe_price_id','price_Catalog315','currency','usd','unit_amount',1900,
    'interval','month','classroom_limit',5,'features',jsonb_build_object('catalog_key','pika:repolight-2026-10-29:pro:usd:month',
      'display_name','Pro','release_tag','repolight-2026-10-29','repolight_analysis',true),'ai_definition',null);
  v_created:=public.billing_register_live_checkout_offering_v1(v_project,v_account,v_request);
  v_duplicate:=public.billing_register_live_checkout_offering_v1(v_project,v_account,v_request);
  v_id:=(v_created->>'offering_version_id')::uuid;
  if v_created->>'created'<>'true' or v_duplicate->>'created'<>'false'
    or v_duplicate->>'offering_version_id'<>v_id::text then raise exception 'Registration not idempotent'; end if;
  if public.billing_get_live_checkout_offering_v1(v_project,v_account,jsonb_build_object('stripe_account',v_account,'offering_version_id',v_id)) is not null
    or jsonb_array_length(public.billing_list_live_checkout_offerings_v1(v_project,v_account,jsonb_build_object('stripe_account',v_account))->'items')<>0
    or private.stripe_live_checkout_offering_v1(v_id,v_account)->>'provider_mode'<>'live' then
    raise exception 'Default availability or pinned recovery differs';
  end if;
  perform public.billing_set_live_checkout_offering_availability_v1(v_project,v_account,jsonb_build_object('offering_version_id',v_id,'is_available',true));
  v_result:=public.billing_get_live_checkout_offering_v1(v_project,v_account,jsonb_build_object('stripe_account',v_account,'offering_version_id',v_id));
  if v_result->>'provider_mode'<>'live' or v_result->>'catalog_key'<>'pika:repolight-2026-10-29:pro:usd:month'
    or (v_result->>'unit_amount')::integer<>1900
    or jsonb_array_length(public.billing_list_live_checkout_offerings_v1(v_project,v_account,jsonb_build_object('stripe_account',v_account))->'items')<>1 then
    raise exception 'Live public catalog projection differs';
  end if;
  v_failed:=false;
  begin perform public.billing_register_live_checkout_offering_v1(v_project,v_account,jsonb_set(v_request,'{unit_amount}','1'));
  exception when invalid_parameter_value then v_failed:=true; end;
  if not v_failed then raise exception 'Noncanonical price accepted'; end if;
  v_failed:=false;
  begin perform public.billing_list_live_checkout_offerings_v1(v_project,'acct_Foreign315',jsonb_build_object('stripe_account','acct_Foreign315'));
  exception when object_not_in_prerequisite_state then v_failed:=true; end;
  if not v_failed then raise exception 'Foreign account accepted'; end if;
  v_failed:=false;
  begin perform public.billing_register_live_checkout_offering_v1(v_project,v_account,
    v_request||jsonb_build_object('version',315002,'stripe_price_id','price_Other315','availability',jsonb_build_object('is_available',true)));
  exception when unique_violation then v_failed:=true; end;
  if not v_failed then raise exception 'Duplicate available catalog key accepted'; end if;
  v_other:=(public.billing_register_live_checkout_offering_v1(v_project,v_account,
    v_request||jsonb_build_object('version',315002,'stripe_price_id','price_Other315'))->>'offering_version_id')::uuid;
  perform public.billing_set_live_checkout_offering_availability_v1(v_project,v_account,jsonb_build_object('offering_version_id',v_id,'is_available',false));
  if public.billing_get_live_checkout_offering_v1(v_project,v_account,jsonb_build_object('stripe_account',v_account,'offering_version_id',v_id)) is not null
    or private.stripe_live_checkout_offering_v1(v_id,v_account) is null then raise exception 'Retirement broke recovery'; end if;
  perform public.billing_set_live_checkout_offering_availability_v1(v_project,v_account,jsonb_build_object('offering_version_id',v_other,'is_available',true));
  if jsonb_array_length(public.billing_list_live_checkout_offerings_v1(v_project,v_account,jsonb_build_object('stripe_account',v_account))->'items')<>1 then
    raise exception 'Replacement availability differs';
  end if;
  v_failed:=false;
  begin perform public.billing_list_checkout_offerings_v1(jsonb_build_object('stripe_account',v_account));
  exception when object_not_in_prerequisite_state then v_failed:=true; end;
  if not v_failed then raise exception 'Sandbox catalog accepted a live target'; end if;
end;
$$;
rollback;
