begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
update private.stripe_billing_settings set sandbox_enabled=true where singleton;
set local role service_role;
-- Every request uses a nonexistent subscription: invalid parameters must be
-- rejected before lookup, and must not accidentally become rejected/lost_claim.
do $$
declare v_rpc text; v_outcome text; v_key text; v_value jsonb; v_request jsonb; v_candidate jsonb; v_result jsonb;
  v_valid jsonb:=jsonb_build_object('subscription_id','f2150000-0000-4000-8000-000000000001',
    'lease_token','f2150000-0000-4000-8000-000000000002','fencing_token',1,
    'expected_subscription_revision',1,'expected_account_plan_revision',1,
    'outcome','exception','reason_code','provider_unavailable');
begin
  foreach v_rpc in array array['billing_finish_subscription_v1','billing_finish_lifecycle_v1'] loop
    foreach v_key in array array['subscription_id','lease_token','fencing_token','expected_subscription_revision','expected_account_plan_revision','outcome','reason_code'] loop
      foreach v_candidate in array array[v_valid-v_key,jsonb_set(v_valid,array[v_key],'null'::jsonb)] loop
        begin
          execute format('select public.%I($1)',v_rpc) into v_result using v_candidate;
          raise exception 'Missing required field accepted by %: %',v_rpc,v_key;
        exception when invalid_parameter_value then
          if sqlerrm<>'stripe_billing_finish_request_invalid' then raise; end if;
        end;
      end loop;
    end loop;
    foreach v_key in array array['fencing_token','expected_subscription_revision','expected_account_plan_revision'] loop
      foreach v_value in array array['0'::jsonb,'-1'::jsonb,'1.5'::jsonb,'"1.0"'::jsonb,'"01"'::jsonb,'""'::jsonb,'true'::jsonb,'[]'::jsonb,'{}'::jsonb] loop
        begin
          execute format('select public.%I($1)',v_rpc) into v_result using jsonb_set(v_valid,array[v_key],v_value);
          raise exception 'Malformed fence accepted by %: % = %',v_rpc,v_key,v_value;
        exception when invalid_parameter_value then
          if sqlerrm<>'stripe_billing_finish_request_invalid' then raise; end if;
        end;
      end loop;
    end loop;
    foreach v_candidate in array array[null::jsonb,'null'::jsonb,'[]'::jsonb,'"bad"'::jsonb,
      v_valid||'{"outcome":"unsupported"}'::jsonb,
      v_valid||'{"reason_code":"not_allowlisted"}'::jsonb,
      v_valid||'{"outcome":"paid","reason_code":"BAD reason"}'::jsonb] loop
      begin
        execute format('select public.%I($1)',v_rpc) into v_result using v_candidate;
        raise exception 'Malformed envelope/outcome/reason accepted by %: %',v_rpc,v_candidate;
      exception when invalid_parameter_value then
        if sqlerrm<>'stripe_billing_finish_request_invalid' then raise; end if;
      end;
    end loop;
    -- Legacy numeric strings remain accepted. Valid nonexistent bindings retain
    -- the original rejected result; this must not manufacture a validation error.
    v_request:=v_valid||'{"fencing_token":"1","expected_subscription_revision":"1","expected_account_plan_revision":"1"}'::jsonb;
    execute format('select public.%I($1)',v_rpc) into v_result using v_request;
    if v_result is distinct from '{"status":"rejected","retry_scheduled":false}'::jsonb then raise exception 'Valid missing binding contract changed'; end if;
    foreach v_outcome in array array['paid','renewal_failed','canceled','observed','noop','exception'] loop
      v_request:=v_valid||jsonb_build_object('outcome',v_outcome,'reason_code',case when v_outcome='exception' then 'provider_unavailable' else null end);
      execute format('select public.%I($1)',v_rpc) into v_result using v_request;
      if v_result is distinct from '{"status":"rejected","retry_scheduled":false}'::jsonb then
        raise exception 'Supported outcome % rejected as malformed by %',v_outcome,v_rpc; end if;
    end loop;
  end loop;
end $$;
reset role;
rollback;
