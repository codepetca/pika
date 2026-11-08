-- A scoped live checkout catalog. This migration does not enable checkout.
begin;

alter table public.stripe_billing_offering_versions
  drop constraint stripe_billing_offering_versions_provider_mode_check,
  add constraint stripe_billing_offering_versions_provider_mode_check check (provider_mode in ('test','live'));

-- All commercial terms and features are a closed copy of the current RepoLight
-- release. This does not create AI entitlement or assert provider-side prices.
create function private.billing_live_checkout_terms_valid_v1(
  p_plan text,p_currency text,p_interval text,p_amount bigint,p_limit integer,p_features jsonb,p_ai jsonb
) returns boolean language sql immutable set search_path='' as $$
  select coalesce(exists (
    select 1 from (values
      ('plus','pro','usd','month',1900::bigint,5),('plus','pro','usd','year',19900::bigint,5),
      ('plus','pro','cad','month',2700::bigint,5),('plus','pro','cad','year',27900::bigint,5),
      ('pro','max','usd','month',3900::bigint,12),('pro','max','usd','year',39900::bigint,12),
      ('pro','max','cad','month',5500::bigint,12),('pro','max','cad','year',55900::bigint,12)
    ) terms(plan_key,public_plan,currency,billing_interval,amount,classroom_limit)
    where terms.plan_key=p_plan and terms.currency=p_currency and terms.billing_interval=p_interval
      and terms.amount=p_amount and terms.classroom_limit=p_limit and p_ai is null
      and p_features=jsonb_build_object(
        'catalog_key','pika:repolight-2026-10-29:'||terms.public_plan||':'||terms.currency||':'||terms.billing_interval,
        'display_name',case terms.public_plan when 'pro' then 'Pro' else 'Max' end,
        'release_tag','repolight-2026-10-29','repolight_analysis',true)
  ),false);
$$;

-- Deliberately independent of availability so a pinned attempt remains
-- recoverable after retirement. Callers must already hold the scoped lock.
create function private.stripe_live_checkout_offering_v1(p_version uuid,p_stripe_account text)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('offering_version_id',v.id,'plan_key',o.plan_key,
    'stripe_account',v.stripe_account,'provider_mode','live','stripe_product_id',v.stripe_product_id,
    'stripe_price_id',v.stripe_price_id,'currency',v.currency,'interval',v.interval,
    'unit_amount',v.unit_amount,'classroom_limit',v.classroom_limit,'catalog_key',v.features->>'catalog_key')
  from public.stripe_billing_offering_versions v join public.stripe_billing_offerings o on o.id=v.offering_id
  where v.id=p_version and v.stripe_account=p_stripe_account and v.provider_mode='live'
    and private.billing_live_checkout_terms_valid_v1(o.plan_key,v.currency,v.interval,v.unit_amount,v.classroom_limit,v.features,v.ai_definition);
$$;

create function public.billing_get_live_checkout_offering_v1(p_project_ref text,p_stripe_account text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if jsonb_typeof(p_request) is distinct from 'object' then
    raise exception using errcode='22023',message='live_checkout_catalog_request_invalid';
  end if;
  if exists(select 1 from jsonb_object_keys(p_request) k(name) where name not in ('stripe_account','offering_version_id'))
    or p_request->>'stripe_account' is distinct from p_stripe_account
    or coalesce(p_request->>'offering_version_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception using errcode='22023',message='live_checkout_catalog_request_invalid';
  end if;
  v_id:=(p_request->>'offering_version_id')::uuid;
  perform private.lock_billing_live_payment_settings_v1(p_project_ref,p_stripe_account);
  perform pg_advisory_xact_lock(hashtextextended('stripe-live-checkout-catalog:'||p_stripe_account,31520261108));
  return (select private.stripe_live_checkout_offering_v1(v.id,p_stripe_account)
    from public.stripe_billing_offering_versions v
    join public.stripe_billing_offering_availability a on a.offering_version_id=v.id
    where v.id=v_id and v.stripe_account=p_stripe_account and v.provider_mode='live'
      and a.is_available and (a.available_from is null or a.available_from<=clock_timestamp())
      and (a.available_until is null or a.available_until>clock_timestamp()));
end;
$$;

create function public.billing_list_live_checkout_offerings_v1(p_project_ref text,p_stripe_account text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_items jsonb;
begin
  if jsonb_typeof(p_request) is distinct from 'object' then
    raise exception using errcode='22023',message='live_checkout_catalog_request_invalid';
  end if;
  if exists(select 1 from jsonb_object_keys(p_request) k(name) where name<>'stripe_account')
    or p_request->>'stripe_account' is distinct from p_stripe_account then
    raise exception using errcode='22023',message='live_checkout_catalog_request_invalid';
  end if;
  perform private.lock_billing_live_payment_settings_v1(p_project_ref,p_stripe_account);
  perform pg_advisory_xact_lock(hashtextextended('stripe-live-checkout-catalog:'||p_stripe_account,31520261108));
  select coalesce(jsonb_agg(item),'[]'::jsonb) into v_items from (
    select private.stripe_live_checkout_offering_v1(v.id,p_stripe_account) as item
    from public.stripe_billing_offering_versions v
    join public.stripe_billing_offering_availability a on a.offering_version_id=v.id
    where v.stripe_account=p_stripe_account and v.provider_mode='live' and a.is_available
      and (a.available_from is null or a.available_from<=clock_timestamp())
      and (a.available_until is null or a.available_until>clock_timestamp())
    order by v.id limit 101
  ) candidates;
  if jsonb_array_length(v_items)>100 or exists(select 1 from jsonb_array_elements(v_items) as candidate(item) where candidate.item='null'::jsonb) then
    raise exception using errcode='55000',message='live_checkout_catalog_invalid';
  end if;
  return jsonb_build_object('items',v_items);
end;
$$;

create function public.billing_register_live_checkout_offering_v1(p_project_ref text,p_stripe_account text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_offering public.stripe_billing_offerings%rowtype;
  v_version public.stripe_billing_offering_versions%rowtype;
  v_number integer; v_amount bigint; v_limit integer; v_available boolean:=false; v_created boolean:=false;
begin
  if jsonb_typeof(p_request) is distinct from 'object' then
    raise exception using errcode='22023',message='live_checkout_offering_invalid';
  end if;
  if exists(select 1 from jsonb_object_keys(p_request) k(name) where name not in
      ('plan_key','version','stripe_account','provider_mode','stripe_product_id','stripe_price_id','currency','unit_amount','interval','classroom_limit','features','ai_definition','availability'))
    or p_request->>'stripe_account' is distinct from p_stripe_account or p_request->>'provider_mode' is distinct from 'live'
    or coalesce(p_request->>'stripe_product_id','') !~ '^prod_[A-Za-z0-9]{1,255}$'
    or coalesce(p_request->>'stripe_price_id','') !~ '^price_[A-Za-z0-9]{1,255}$'
    or jsonb_typeof(p_request->'version') is distinct from 'number'
    or coalesce(p_request->>'version','') !~ '^[1-9][0-9]{0,8}$'
    or jsonb_typeof(p_request->'unit_amount') is distinct from 'number'
    or coalesce(p_request->>'unit_amount','') !~ '^[0-9]{1,9}$'
    or jsonb_typeof(p_request->'classroom_limit') is distinct from 'number'
    or coalesce(p_request->>'classroom_limit','') !~ '^[0-9]{1,4}$'
    or jsonb_typeof(p_request->'features') is distinct from 'object'
    or not (p_request ? 'ai_definition') or p_request->'ai_definition' is distinct from 'null'::jsonb
    or (p_request ? 'availability' and jsonb_typeof(p_request->'availability') is distinct from 'object') then
    raise exception using errcode='22023',message='live_checkout_offering_invalid';
  end if;
  if p_request ? 'availability' then
    if exists(select 1 from jsonb_object_keys(p_request->'availability') k(name) where name<>'is_available')
      or jsonb_typeof(p_request->'availability'->'is_available') is distinct from 'boolean' then
      raise exception using errcode='22023',message='live_checkout_offering_invalid';
    end if;
    v_available:=(p_request->'availability'->>'is_available')::boolean;
  end if;
  v_number:=(p_request->>'version')::integer; v_amount:=(p_request->>'unit_amount')::bigint;
  v_limit:=(p_request->>'classroom_limit')::integer;
  if not private.billing_live_checkout_terms_valid_v1(p_request->>'plan_key',p_request->>'currency',
    p_request->>'interval',v_amount,v_limit,p_request->'features',null) then
    raise exception using errcode='22023',message='live_checkout_offering_invalid';
  end if;
  perform private.lock_billing_live_payment_settings_v1(p_project_ref,p_stripe_account);
  perform pg_advisory_xact_lock(hashtextextended('stripe-live-checkout-catalog:'||p_stripe_account,31520261108));
  insert into public.stripe_billing_offerings(plan_key) values(p_request->>'plan_key')
    on conflict(plan_key) do nothing returning * into v_offering;
  if v_offering.id is null then select * into strict v_offering from public.stripe_billing_offerings where plan_key=p_request->>'plan_key'; end if;
  select * into v_version from public.stripe_billing_offering_versions
    where stripe_account=p_stripe_account and provider_mode='live' and stripe_price_id=p_request->>'stripe_price_id';
  if found then
    if to_jsonb(v_version)-'id'-'created_at' <> jsonb_build_object('offering_id',v_offering.id,'version',v_number,
      'stripe_account',p_stripe_account,'provider_mode','live','stripe_product_id',p_request->>'stripe_product_id',
      'stripe_price_id',p_request->>'stripe_price_id','currency',p_request->>'currency','unit_amount',v_amount,
      'interval',p_request->>'interval','classroom_limit',v_limit,'features',p_request->'features','ai_definition',null) then
      raise exception using errcode='23505',message='live_checkout_offering_conflict';
    end if;
  else
    if v_available and exists(select 1 from public.stripe_billing_offering_versions version
      join public.stripe_billing_offering_availability availability on availability.offering_version_id=version.id
      where version.stripe_account=p_stripe_account and version.provider_mode='live'
        and version.features->>'catalog_key'=p_request->'features'->>'catalog_key' and availability.is_available) then
      raise exception using errcode='23505',message='live_checkout_catalog_conflict';
    end if;
    insert into public.stripe_billing_offering_versions(offering_id,version,stripe_account,provider_mode,stripe_product_id,
      stripe_price_id,currency,unit_amount,interval,classroom_limit,features,ai_definition)
    values(v_offering.id,v_number,p_stripe_account,'live',p_request->>'stripe_product_id',p_request->>'stripe_price_id',
      p_request->>'currency',v_amount,p_request->>'interval',v_limit,p_request->'features',null) returning * into v_version;
    insert into public.stripe_billing_offering_availability(offering_version_id,is_available) values(v_version.id,v_available);
    v_created:=true;
  end if;
  return jsonb_build_object('offering_id',v_offering.id,'offering_version_id',v_version.id,'created',v_created);
end;
$$;

create function public.billing_set_live_checkout_offering_availability_v1(p_project_ref text,p_stripe_account text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_available boolean; v_version public.stripe_billing_offering_versions%rowtype;
begin
  if jsonb_typeof(p_request) is distinct from 'object' then
    raise exception using errcode='22023',message='live_checkout_availability_invalid';
  end if;
  if exists(select 1 from jsonb_object_keys(p_request) k(name) where name not in ('offering_version_id','is_available'))
    or coalesce(p_request->>'offering_version_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(p_request->'is_available') is distinct from 'boolean' then
    raise exception using errcode='22023',message='live_checkout_availability_invalid';
  end if;
  v_id:=(p_request->>'offering_version_id')::uuid; v_available:=(p_request->>'is_available')::boolean;
  perform private.lock_billing_live_payment_settings_v1(p_project_ref,p_stripe_account);
  perform pg_advisory_xact_lock(hashtextextended('stripe-live-checkout-catalog:'||p_stripe_account,31520261108));
  select * into v_version from public.stripe_billing_offering_versions
    where id=v_id and stripe_account=p_stripe_account and provider_mode='live';
  if not found or private.stripe_live_checkout_offering_v1(v_id,p_stripe_account) is null then
    raise exception using errcode='55000',message='live_checkout_offering_unavailable';
  end if;
  if v_available and exists(select 1 from public.stripe_billing_offering_versions version
    join public.stripe_billing_offering_availability availability on availability.offering_version_id=version.id
    where version.id<>v_id and version.stripe_account=p_stripe_account and version.provider_mode='live'
      and version.features->>'catalog_key'=v_version.features->>'catalog_key' and availability.is_available) then
    raise exception using errcode='23505',message='live_checkout_catalog_conflict';
  end if;
  update public.stripe_billing_offering_availability set is_available=v_available,available_from=null,available_until=null,updated_at=clock_timestamp()
    where offering_version_id=v_id;
  if not found then raise exception using errcode='55000',message='live_checkout_offering_unavailable'; end if;
  return jsonb_build_object('offering_version_id',v_id,'is_available',v_available);
end;
$$;

revoke all on function private.billing_live_checkout_terms_valid_v1(text,text,text,bigint,integer,jsonb,jsonb),
  private.stripe_live_checkout_offering_v1(uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.billing_get_live_checkout_offering_v1(text,text,jsonb),
  public.billing_list_live_checkout_offerings_v1(text,text,jsonb),
  public.billing_register_live_checkout_offering_v1(text,text,jsonb),
  public.billing_set_live_checkout_offering_availability_v1(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.billing_get_live_checkout_offering_v1(text,text,jsonb),
  public.billing_list_live_checkout_offerings_v1(text,text,jsonb),
  public.billing_register_live_checkout_offering_v1(text,text,jsonb),
  public.billing_set_live_checkout_offering_availability_v1(text,text,jsonb) to service_role;
commit;
