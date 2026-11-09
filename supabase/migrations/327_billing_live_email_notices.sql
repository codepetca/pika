-- Transactional teacher notices for known live cutoffs and materialized expiry.
begin;

alter table private.stripe_billing_settings
  add column live_email_notices_enabled boolean not null default false,
  add constraint stripe_billing_live_email_notice_controls check (
    not live_email_notices_enabled or (live_project_ref is not null and live_stripe_account is not null
      and not sandbox_enabled and classroom_new_work_cutoff_enabled)
  );

create table private.billing_live_email_notices (
  id uuid primary key default gen_random_uuid(),
  project_ref text not null check (project_ref ~ '^[a-z0-9]{20}$'),
  stripe_account text not null check (stripe_account ~ '^acct_[A-Za-z0-9]{1,255}$'),
  subject_user_id uuid not null references public.users(id) on delete cascade,
  source text not null check (source in ('trial','paid')),
  source_id uuid not null,
  access_revision bigint not null check (access_revision>0),
  access_ends_at timestamptz not null check (isfinite(access_ends_at)),
  kind text not null check (kind in ('cancellation','renewal_failed','ending_7_days','ending_24_hours','expired')),
  due_at timestamptz not null,
  state text not null default 'pending' check (state in ('pending','sending','sent','suppressed','attention')),
  claim_token uuid,
  sending_started_at timestamptz,
  finished_at timestamptz,
  unique(project_ref,stripe_account,subject_user_id,source,source_id,access_revision,access_ends_at,kind),
  check ((state in ('sending','sent','attention'))=(claim_token is not null and sending_started_at is not null)),
  check ((state in ('sent','suppressed','attention'))=(finished_at is not null))
);
alter table private.billing_live_email_notices enable row level security;
revoke all on private.billing_live_email_notices from public,anon,authenticated,service_role;
create index billing_live_email_notices_pending_idx
  on private.billing_live_email_notices(project_ref,stripe_account,due_at,id) where state='pending';
create index billing_live_email_notices_sending_idx
  on private.billing_live_email_notices(project_ref,stripe_account,sending_started_at,id) where state='sending';
create index billing_live_email_notices_subject_idx on private.billing_live_email_notices(subject_user_id);
comment on table private.billing_live_email_notices is
  'Live email outbox. Authorized database operators can inspect counts by state and scoped notice IDs. Recipient addresses are resolved only during claim. Attention is terminal.';

-- The source ID is the immutable trial operation or the exact paid binding.
-- Paid custody is fully checked at claim, after the invoice effect has committed.
create function private.billing_live_email_notice_source_v1(
  p_access public.billing_account_access,p_project_ref text,p_stripe_account text
) returns uuid language sql stable set search_path='' as $$
  select case p_access.source
    when 'trial' then (
      select source.operation_id from private.billing_live_trial_sources source
      join public.billing_trials trial on trial.subject_user_id=source.subject_user_id and trial.operation_id=source.operation_id
      where source.subject_user_id=p_access.subject_user_id and p_access.trial_subject_user_id=source.subject_user_id
        and source.project_ref=p_project_ref and source.stripe_account=p_stripe_account
        and trial.definition_id='pro-trial-v1' and trial.converted_to_paid_at is null
        and trial.started_at=p_access.starts_at and trial.ends_at=p_access.access_ends_at and p_access.end_reason='trial'
    )
    when 'paid' then (
      select binding.id from public.stripe_billing_subscription_bindings binding
      where binding.id=p_access.subscription_id and binding.subject_user_id=p_access.subject_user_id
        and binding.offering_version_id=p_access.offering_version_id and binding.provider_mode='live'
        and binding.stripe_account=p_stripe_account and p_access.last_provider_verified_at is not null
        and p_access.end_reason in ('cancellation','renewal_grace')
    )
  end;
$$;

create function private.billing_live_email_notice_valid_v1(
  p_access public.billing_account_access,p_project_ref text,p_stripe_account text,p_kind text,p_now timestamptz
) returns boolean language sql stable set search_path='' as $$
  select coalesce(
    p_access.starts_at<=p_now
    and case p_kind
      when 'expired' then p_access.access_ends_at<=p_now and p_access.expiry_applied_at>=p_access.access_ends_at
      else p_access.access_ends_at>p_now and p_access.expiry_applied_at is null
    end
    and case p_kind
      when 'cancellation' then p_access.end_reason='cancellation'
      when 'renewal_failed' then p_access.end_reason='renewal_grace' and p_access.failed_renewal_invoice_id is not null
      else true
    end
    and case p_access.source
      when 'paid' then
        private.billing_live_reconciliation_binding_v1(p_access.subscription_id,p_stripe_account) is not null
        and private.billing_live_reconciliation_plan_valid_v1(p_access.subscription_id,p_project_ref,p_stripe_account)
        and (p_kind='expired' or exists(select 1 from public.stripe_billing_subscription_bindings binding
          where binding.id=p_access.subscription_id and binding.is_current))
        and not private.billing_live_undo_awaiting_proof_v1(p_access.subscription_id)
      when 'trial' then exists(
        select 1 from public.account_plans plan
        join public.effective_feature_entitlements entitlement on entitlement.subject_user_id=plan.subject_user_id
          and entitlement.feature_key='classrooms.create' and entitlement.revision=p_access.entitlement_revision
          and entitlement.source='trial'
        where plan.subject_user_id=p_access.subject_user_id and plan.revision=p_access.account_plan_revision
          and plan.management_source='trial' and plan.billing_offering_version_id is null
          and (case when p_kind='expired' then plan.plan_key='free' and not entitlement.enabled
              and entitlement.quota_limit=0 and entitlement.expires_at is null
            else plan.plan_key='plus' and entitlement.enabled and entitlement.quota_limit=5
              and entitlement.starts_at=p_access.starts_at and entitlement.expires_at=p_access.access_ends_at end)
      )
      else false
    end,false);
$$;

create function private.billing_enqueue_live_email_notices_v1(
  p_access public.billing_account_access,p_project_ref text,p_stripe_account text,
  p_now timestamptz,p_cutoff_known boolean,p_expired boolean,p_include_confirmation boolean
) returns void language plpgsql set search_path='' as $$
declare v_source_id uuid;
begin
  if not isfinite(p_access.access_ends_at)
    or not exists(select 1 from public.users where id=p_access.subject_user_id and role='teacher') then return; end if;
  v_source_id:=private.billing_live_email_notice_source_v1(p_access,p_project_ref,p_stripe_account);
  if v_source_id is null then return; end if;
  insert into private.billing_live_email_notices(project_ref,stripe_account,subject_user_id,
    source,source_id,access_revision,access_ends_at,kind,due_at)
  select p_project_ref,p_stripe_account,p_access.subject_user_id,p_access.source,
    v_source_id,p_access.revision,p_access.access_ends_at,notice.kind,notice.due_at
  from (values
    ('cancellation',p_now,p_include_confirmation and p_cutoff_known and p_access.end_reason='cancellation'
      and p_access.access_ends_at>p_now),
    ('renewal_failed',p_now,p_include_confirmation and p_cutoff_known and p_access.end_reason='renewal_grace'
      and p_access.access_ends_at>p_now),
    ('ending_7_days',p_access.access_ends_at-interval '168 hours',p_cutoff_known
      and p_access.access_ends_at-interval '168 hours'>p_now),
    ('ending_24_hours',p_access.access_ends_at-interval '24 hours',p_cutoff_known
      and p_access.access_ends_at-interval '24 hours'>p_now),
    ('expired',p_now,p_expired and p_access.expiry_applied_at>=p_access.access_ends_at and p_access.access_ends_at<=p_now)
  ) notice(kind,due_at,eligible)
  where notice.eligible
  on conflict(project_ref,stripe_account,subject_user_id,source,source_id,access_revision,access_ends_at,kind) do nothing;
end;
$$;

create function private.capture_billing_live_email_notice_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_project_ref text;
  v_stripe_account text;
  v_cutoff_known boolean;
  v_expired boolean;
begin
  if new.end_reason='renewal_pending' then return null; end if;
  if tg_op='INSERT' then
    v_cutoff_known:=new.expiry_applied_at is null;
    v_expired:=new.expiry_applied_at is not null;
  else
    v_cutoff_known:=new.expiry_applied_at is null and
      (old.source,old.subscription_id,old.trial_subject_user_id,old.revision,old.access_ends_at,old.end_reason,old.expiry_applied_at)
      is distinct from
      (new.source,new.subscription_id,new.trial_subject_user_id,new.revision,new.access_ends_at,new.end_reason,new.expiry_applied_at);
    v_expired:=new.expiry_applied_at is not null and new.expiry_applied_at is distinct from old.expiry_applied_at;
  end if;
  if not (v_cutoff_known or v_expired) then return null; end if;

  -- The live writers already hold the settings share lock before touching access.
  -- This read never takes a settings lock while holding an access row.
  select live_project_ref,live_stripe_account into v_project_ref,v_stripe_account
    from private.stripe_billing_settings where singleton and live_email_notices_enabled;
  if not found then return null; end if;
  perform private.billing_enqueue_live_email_notices_v1(new,v_project_ref,v_stripe_account,
    clock_timestamp(),v_cutoff_known,v_expired,true);
  return null;
end;
$$;

create trigger capture_billing_live_email_notice after insert or update of source,subscription_id,trial_subject_user_id,
  revision,access_ends_at,end_reason,expiry_applied_at on public.billing_account_access
  for each row execute function private.capture_billing_live_email_notice_v1();

-- Enabling after migration or a pause can schedule future reminders for known
-- live terms. It cannot manufacture an old confirmation or expiry message.
create function private.enable_billing_live_email_notices_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_access public.billing_account_access%rowtype;
  v_now timestamptz:=clock_timestamp();
begin
  if not new.live_email_notices_enabled or old.live_email_notices_enabled then return null; end if;
  if not private.billing_live_target_proven_v1(new.live_project_ref,new.live_stripe_account) then
    raise exception using errcode='55000',message='billing_live_email_notice_target_not_attested';
  end if;
  for v_access in
    select access.* from public.billing_account_access access
    join public.users subject on subject.id=access.subject_user_id and subject.role='teacher'
    where access.expiry_applied_at is null and access.end_reason in ('trial','cancellation','renewal_grace')
      and access.access_ends_at>v_now+interval '24 hours'
      and private.billing_live_email_notice_source_v1(access,new.live_project_ref,new.live_stripe_account) is not null
      and private.billing_live_email_notice_valid_v1(access,new.live_project_ref,new.live_stripe_account,'ending_24_hours',v_now)
  loop
    perform private.billing_enqueue_live_email_notices_v1(v_access,new.live_project_ref,new.live_stripe_account,
      v_now,true,false,false);
  end loop;
  return null;
end;
$$;

create trigger enable_billing_live_email_notices after update of live_email_notices_enabled
  on private.stripe_billing_settings for each row execute function private.enable_billing_live_email_notices_v1();

create function public.billing_claim_live_email_notice_v1(p_project_ref text,p_stripe_account text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_notice private.billing_live_email_notices%rowtype;
  v_access public.billing_account_access%rowtype;
  v_now timestamptz:=clock_timestamp();
  v_attention integer;
  v_binding_valid boolean;
  v_recipient text;
  v_token uuid;
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception using errcode='40001',message='billing_live_email_notices_require_read_committed';
  end if;
  perform 1 from private.stripe_billing_settings where singleton and live_email_notices_enabled
    and live_project_ref=p_project_ref and live_stripe_account=p_stripe_account for share;
  if not found then return '{"status":"disabled","attention":0}'::jsonb; end if;

  -- A sender may have reached the provider before losing its response. Never
  -- release that row for a second send, even if the worker disappears.
  with interrupted as (
    select id from private.billing_live_email_notices
    where project_ref=p_project_ref and stripe_account=p_stripe_account and state='sending'
      and sending_started_at<=v_now-interval '5 minutes'
    order by sending_started_at,id limit 20 for update skip locked
  )
  update private.billing_live_email_notices notice set state='attention',finished_at=v_now
  from interrupted where notice.id=interrupted.id;
  get diagnostics v_attention=row_count;

  for v_notice in
    select * from private.billing_live_email_notices
    where project_ref=p_project_ref and stripe_account=p_stripe_account and state='pending' and due_at<=v_now
    order by due_at,id limit 20
  loop
    -- Match lifecycle lock order (settings, binding, plan, feature/access).
    -- All per-account fences are nonblocking. Raising inside this block
    -- releases the candidate's fences if any peer is already changing it.
    begin
      v_binding_valid:=true;
      if v_notice.source='paid' then
        perform 1 from public.stripe_billing_subscription_bindings
          where id=v_notice.source_id and subject_user_id=v_notice.subject_user_id
            and provider_mode='live' and stripe_account=p_stripe_account for share nowait;
        v_binding_valid:=found;
      end if;
      if not pg_try_advisory_xact_lock(hashtextextended('account-plan-subject:'||v_notice.subject_user_id::text,20620260924)) then
        raise lock_not_available;
      end if;
      perform 1 from public.account_plans where subject_user_id=v_notice.subject_user_id for share nowait;
      if not pg_try_advisory_xact_lock(hashtextextended(v_notice.subject_user_id::text||':classrooms.create',16620260912)) then
        raise lock_not_available;
      end if;
      select * into v_access from public.billing_account_access where subject_user_id=v_notice.subject_user_id for share nowait;
      perform 1 from public.effective_feature_entitlements where subject_user_id=v_notice.subject_user_id
        and feature_key='classrooms.create' for share nowait;
      v_now:=clock_timestamp();
      v_recipient:=null;
      if v_binding_valid and v_access.source=v_notice.source and v_access.revision=v_notice.access_revision
        and v_access.access_ends_at=v_notice.access_ends_at
        and private.billing_live_email_notice_source_v1(v_access,p_project_ref,p_stripe_account)=v_notice.source_id
        and (v_notice.kind not in ('ending_7_days','ending_24_hours') or v_now<v_notice.due_at+interval '24 hours')
        and private.billing_live_email_notice_valid_v1(v_access,p_project_ref,p_stripe_account,v_notice.kind,v_now) then
        select subject.email into v_recipient from public.users subject where subject.id=v_notice.subject_user_id
          and subject.role='teacher' and subject.email_verified_at is not null
          and char_length(subject.email)<=254 and subject.email ~ '^[^[:space:]@]+@[^[:space:]@]+$'
          for share nowait;
      end if;

      perform 1 from private.billing_live_email_notices where id=v_notice.id and state='pending' for update nowait;
      if not found then raise lock_not_available; end if;
      if v_recipient is null then
        update private.billing_live_email_notices set state='suppressed',finished_at=v_now where id=v_notice.id;
      else
        v_token:=gen_random_uuid();
        update private.billing_live_email_notices set state='sending',claim_token=v_token,sending_started_at=v_now
          where id=v_notice.id;
        return jsonb_build_object('status','claimed','attention',v_attention,'notice',jsonb_build_object(
          'id',v_notice.id,'claim_token',v_token,'recipient',v_recipient,'kind',v_notice.kind,
          'source',v_notice.source,'access_ends_at',v_notice.access_ends_at));
      end if;
    exception when lock_not_available then
      continue;
    end;
  end loop;
  return jsonb_build_object('status','empty','attention',v_attention);
end;
$$;

create function public.billing_finish_live_email_notice_v1(p_project_ref text,p_stripe_account text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_outcome text:=p_request->>'outcome'; v_now timestamptz:=clock_timestamp();
begin
  if jsonb_typeof(p_request) is distinct from 'object'
    or p_request-array['id','claim_token','outcome']<>'{}'::jsonb
    or coalesce(p_request->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(p_request->>'claim_token','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(v_outcome,'') not in ('sent','attention') then
    raise exception using errcode='22023',message='billing_live_email_notice_finish_invalid';
  end if;
  -- An already-started delivery can record its outcome while dispatch is paused.
  perform 1 from private.stripe_billing_settings where singleton
    and live_project_ref=p_project_ref and live_stripe_account=p_stripe_account for share;
  if not found then return '{"status":"stale"}'::jsonb; end if;
  update private.billing_live_email_notices set state=v_outcome,finished_at=v_now
    where id=(p_request->>'id')::uuid and claim_token=(p_request->>'claim_token')::uuid
      and project_ref=p_project_ref and stripe_account=p_stripe_account and state='sending'
      and sending_started_at>v_now-interval '5 minutes';
  return jsonb_build_object('status',case when found then v_outcome else 'stale' end);
end;
$$;

revoke all on function private.billing_live_email_notice_source_v1(public.billing_account_access,text,text),
  private.billing_live_email_notice_valid_v1(public.billing_account_access,text,text,text,timestamptz),
  private.billing_enqueue_live_email_notices_v1(public.billing_account_access,text,text,timestamptz,boolean,boolean,boolean),
  private.capture_billing_live_email_notice_v1(),private.enable_billing_live_email_notices_v1()
  from public,anon,authenticated,service_role;
revoke all on function public.billing_claim_live_email_notice_v1(text,text),public.billing_finish_live_email_notice_v1(text,text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.billing_claim_live_email_notice_v1(text,text),public.billing_finish_live_email_notice_v1(text,text,jsonb)
  to service_role;

commit;
