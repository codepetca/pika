-- A guarded scheduled assignment stays a draft until the worker commits.
begin;

create table private.billing_assignment_release_intents (
  id uuid primary key default gen_random_uuid(),
  generation bigint generated always as identity,
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  classroom_id uuid not null,
  subject_user_id uuid not null,
  scheduled_for timestamptz not null check (isfinite(scheduled_for)),
  created_at timestamptz not null default clock_timestamp(),
  state text not null default 'pending' check (state in ('pending','released','suppressed','superseded','cancelled')),
  processed_at timestamptz,
  owner_resolved_at timestamptz check (owner_resolved_at is null or state='suppressed'),
  notice_code text check (notice_code in ('access_unavailable','classroom_unavailable','deadline_before_schedule')),
  check (scheduled_for>created_at),
  check ((state='pending')=(processed_at is null)),
  check ((state='suppressed')=(notice_code is not null))
);
alter table private.billing_assignment_release_intents enable row level security;
revoke all on table private.billing_assignment_release_intents from public,anon,authenticated,service_role;
revoke all on sequence private.billing_assignment_release_intents_generation_seq from public,anon,authenticated,service_role;
create unique index billing_assignment_release_one_pending
  on private.billing_assignment_release_intents(assignment_id) where state='pending';
create index billing_assignment_release_due
  on private.billing_assignment_release_intents(scheduled_for,id) where state='pending';
create index billing_assignment_release_history
  on private.billing_assignment_release_intents(assignment_id,generation desc);

create function private.billing_classroom_had_release_access_v1(p_subject uuid,p_classroom uuid,p_at timestamptz)
returns boolean language sql stable set search_path='' as $$
  select coalesce((
    select grant_at_due.new_enabled and grant_at_due.new_quota_limit>0
      and grant_at_due.new_starts_at<=p_at and grant_at_due.new_expires_at>p_at
      and exists(select 1 from public.account_plan_audit plan
        where plan.operation_id=grant_at_due.operation_id and plan.subject_user_id=p_subject
          and plan.entitlement_revision=grant_at_due.entitlement_revision and plan.created_at<=p_at
          and plan.actor_ref='stripe:billing' and plan.new_plan_key<>'free'
          and plan.new_classroom_limit=grant_at_due.new_quota_limit)
    from public.effective_feature_entitlement_audit grant_at_due
    where grant_at_due.subject_user_id=p_subject and grant_at_due.feature_key='classrooms.create'
      and grant_at_due.created_at<=p_at
    order by grant_at_due.created_at desc,grant_at_due.entitlement_revision desc limit 1
  ),false) and not exists(select 1 from private.billing_classroom_restrictions restriction
    where restriction.subject_user_id=p_subject and restriction.classroom_id=p_classroom
      and restriction.restricted_at<=p_at and (restriction.restored_at is null or restriction.restored_at>p_at));
$$;

create function private.assignment_release_schedule_payload_v1(p_intent private.billing_assignment_release_intents)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('id',p_intent.id,'scheduled_for',p_intent.scheduled_for,
    'state',p_intent.state,'notice_code',p_intent.notice_code);
$$;

create function private.lock_billing_assignment_release_owner_v1(p_actor_id uuid,p_assignment_id uuid)
returns public.assignments language plpgsql set search_path='' as $$
declare
  v_owner uuid;
begin
  if p_actor_id is null or p_assignment_id is null then
    raise exception using errcode='22023',message='Invalid assignment owner mutation request';
  end if;
  -- Reject a foreign ID before entering its advisory namespace. The shared
  -- owner mutation helper still verifies binding and authority under lock.
  select classroom.teacher_id into v_owner from public.assignments assignment
  join public.classrooms classroom on classroom.id=assignment.classroom_id
  where assignment.id=p_assignment_id;
  if not found then
    raise exception using errcode='P0002',message='Assignment not found';
  end if;
  if v_owner is distinct from p_actor_id then
    raise exception using errcode='42501',message='Forbidden';
  end if;
  return private.lock_assignment_owner_mutation_context_v1(p_actor_id,p_assignment_id);
end;
$$;

-- Select the latest generation before filtering its state so an older notice
-- cannot reappear after the owner replaces, cancels or publishes a schedule.
create function public.get_assignment_release_states_for_owner_v1(
  p_actor_id uuid,p_classroom_id uuid,p_assignment_ids uuid[]
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if p_actor_id is null or p_classroom_id is null or p_assignment_ids is null
    or cardinality(p_assignment_ids)>100 then
    raise exception using errcode='22023',message='billing_assignment_release_read_invalid';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object('assignment_id',assignment.id,
      'updated_at',assignment.updated_at,'release_schedule',intent.release_schedule)
      order by assignment.id),'[]'::jsonb)
    from public.classrooms classroom
    join public.assignments assignment on assignment.classroom_id=classroom.id
    cross join lateral (
      select candidate.*,private.assignment_release_schedule_payload_v1(candidate) as release_schedule
      from private.billing_assignment_release_intents candidate
      where candidate.assignment_id=assignment.id order by candidate.generation desc limit 1
    ) intent
    where classroom.id=p_classroom_id and classroom.teacher_id=p_actor_id and classroom.archived_at is null
      and assignment.id=any(p_assignment_ids) and assignment.is_draft and assignment.released_at is null
      and assignment.blueprint_archived_at is null
      and intent.classroom_id=classroom.id and intent.subject_user_id=p_actor_id
      and intent.state in ('pending','suppressed') and intent.owner_resolved_at is null
  );
end;
$$;

create function public.schedule_assignment_for_billing_v1(
  p_actor_id uuid,p_assignment_id uuid,p_scheduled_for timestamptz,p_expected_intent_id uuid default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_assignment public.assignments%rowtype;
  v_intent private.billing_assignment_release_intents%rowtype;
  v_now timestamptz;
  v_has_current boolean;
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception using errcode='40001',message='billing_assignment_publication_requires_read_committed';
  end if;
  v_assignment:=private.lock_billing_assignment_release_owner_v1(p_actor_id,p_assignment_id);
  select * into v_intent from private.billing_assignment_release_intents
    where assignment_id=p_assignment_id order by generation desc limit 1 for update;
  v_has_current:=coalesce(v_intent.state='pending' or (v_intent.state='suppressed' and v_intent.owner_resolved_at is null
    and v_intent.classroom_id=v_assignment.classroom_id and v_intent.subject_user_id=p_actor_id),false);
  if (p_expected_intent_id is not null and (not v_has_current or v_intent.id<>p_expected_intent_id))
    or (v_has_current and (not v_assignment.is_draft or v_assignment.released_at is not null
      or v_intent.classroom_id is distinct from v_assignment.classroom_id
      or v_intent.subject_user_id is distinct from p_actor_id)) then
    raise exception using errcode='PT409',message='billing_assignment_schedule_changed';
  end if;
  if v_has_current and v_intent.state='pending' and v_intent.scheduled_for=p_scheduled_for then
    return jsonb_build_object('assignment',to_jsonb(v_assignment),
      'release_schedule',private.assignment_release_schedule_payload_v1(v_intent));
  end if;
  if v_has_current and p_expected_intent_id is null then
    raise exception using errcode='PT409',message='billing_assignment_schedule_changed';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||p_actor_id::text,20620260924));
  if not exists(select 1 from private.stripe_billing_settings where singleton and classroom_new_work_cutoff_enabled)
    or not exists(select 1 from public.account_plans
      where subject_user_id=p_actor_id and management_source in ('trial','billing')) then
    if not v_has_current then return null; end if;
    raise exception using errcode='PT403',message='billing_classroom_new_work_unavailable';
  end if;
  if not private.billing_classroom_can_start_work_v1(v_assignment.classroom_id) then
    raise exception using errcode='PT403',message='billing_classroom_new_work_unavailable';
  end if;
  v_now:=clock_timestamp();
  if not v_assignment.is_draft or v_assignment.released_at is not null or p_scheduled_for is null
    or not isfinite(p_scheduled_for) or p_scheduled_for<=v_now or p_scheduled_for>v_assignment.due_at then
    raise exception using errcode='PT400',message='billing_assignment_schedule_invalid';
  end if;

  -- Retain suppressed history (and its reason); replacing a pending intent
  -- marks it terminal so an already queued worker cannot publish it.
  if v_intent.state='pending' then
    update private.billing_assignment_release_intents set state='superseded',processed_at=v_now
      where id=v_intent.id;
  end if;
  insert into private.billing_assignment_release_intents(assignment_id,classroom_id,subject_user_id,scheduled_for,created_at)
  values(p_assignment_id,v_assignment.classroom_id,p_actor_id,p_scheduled_for,v_now) returning * into v_intent;

  -- Create an Assignment row version as well as a private generation. An
  -- older repeatable-read direct writer must not miss this newly queued intent.
  update public.assignments set updated_at=v_now where id=p_assignment_id returning * into v_assignment;
  return jsonb_build_object('assignment',to_jsonb(v_assignment),
    'release_schedule',private.assignment_release_schedule_payload_v1(v_intent));
end;
$$;

-- Both owner actions lock in the same order as rescheduling and the worker.
create function private.apply_assignment_release_intent_for_owner_v1(
  p_actor_id uuid,p_assignment_id uuid,p_expected_intent_id uuid,p_publish boolean
)
returns jsonb language plpgsql set search_path='' as $$
declare
  v_assignment public.assignments%rowtype;
  v_intent private.billing_assignment_release_intents%rowtype;
  v_now timestamptz;
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception using errcode='40001',message='billing_assignment_publication_requires_read_committed';
  end if;
  v_assignment:=private.lock_billing_assignment_release_owner_v1(p_actor_id,p_assignment_id);
  select * into v_intent from private.billing_assignment_release_intents
    where assignment_id=p_assignment_id order by generation desc limit 1 for update;
  if not found or p_expected_intent_id is null or v_intent.id<>p_expected_intent_id
    or v_intent.state not in ('pending','suppressed') or v_intent.owner_resolved_at is not null
    or not v_assignment.is_draft or v_assignment.released_at is not null
    or v_intent.classroom_id is distinct from v_assignment.classroom_id
    or v_intent.subject_user_id is distinct from p_actor_id then
    raise exception using errcode='PT409',message='billing_assignment_schedule_changed';
  end if;
  if p_publish then
    if not exists(select 1 from private.stripe_billing_settings where singleton and classroom_new_work_cutoff_enabled)
      or not private.billing_classroom_can_start_work_v1(v_assignment.classroom_id) then
      raise exception using errcode='PT403',message='billing_classroom_new_work_unavailable';
    end if;
  end if;
  v_now:=clock_timestamp();

  if v_intent.state='pending' then
    update private.billing_assignment_release_intents
      set state=case when p_publish then 'released' else 'cancelled' end,processed_at=v_now where id=v_intent.id;
  else
    -- Preserve the prior suppression reason and its original processing time.
    update private.billing_assignment_release_intents set owner_resolved_at=v_now where id=v_intent.id;
  end if;

  if p_publish then
    update public.assignments set is_draft=false,released_at=v_now where id=p_assignment_id returning * into v_assignment;
  else
    update public.assignments set updated_at=v_now where id=p_assignment_id returning * into v_assignment;
  end if;
  return jsonb_build_object('assignment',to_jsonb(v_assignment),'release_schedule',null);
end;
$$;

create function public.cancel_assignment_release_for_owner_v1(
  p_actor_id uuid,p_assignment_id uuid,p_expected_intent_id uuid
)
returns jsonb language sql security definer set search_path='' as $$
  select private.apply_assignment_release_intent_for_owner_v1(p_actor_id,p_assignment_id,p_expected_intent_id,false);
$$;

create function public.publish_scheduled_assignment_for_owner_v1(
  p_actor_id uuid,p_assignment_id uuid,p_expected_intent_id uuid
)
returns jsonb language sql security definer set search_path='' as $$
  select private.apply_assignment_release_intent_for_owner_v1(p_actor_id,p_assignment_id,p_expected_intent_id,true);
$$;

-- Ordinary writes cannot bypass the owner or worker generation check, even
-- with the runtime flag off. The sanctioned paths finish the intent first
-- under the same Assignment lock and in the same transaction.
create function private.guard_billing_assignment_release_intent_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists (
    select 1 from (
      select state,classroom_id,subject_user_id,owner_resolved_at from private.billing_assignment_release_intents
      where assignment_id=old.id order by generation desc limit 1
    ) intent
    where intent.state='pending' or (intent.state='suppressed' and intent.owner_resolved_at is null
      and intent.classroom_id=old.classroom_id and exists (
        select 1 from public.classrooms classroom where classroom.id=old.classroom_id
          and classroom.teacher_id=intent.subject_user_id
      ))
  ) then
    raise exception using errcode='PT409',message='billing_assignment_schedule_changed';
  end if;
  return new;
end;
$$;

create trigger billing_assignment_release_intent_fence
  before update of id,is_draft,released_at,classroom_id on public.assignments
  for each row when (old.is_draft and old.released_at is null and
    (not new.is_draft or new.released_at is not null or new.id is distinct from old.id
      or new.classroom_id is distinct from old.classroom_id))
  execute function private.guard_billing_assignment_release_intent_v1();

create function public.list_due_billing_assignment_releases_v1(p_limit integer)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if p_limit is null or p_limit not between 1 and 25 then
    raise exception using errcode='22023',message='billing_assignment_release_limit_invalid';
  end if;
  if not exists(select 1 from private.stripe_billing_settings where singleton and classroom_new_work_cutoff_enabled) then
    return '[]'::jsonb;
  end if;
  return (select coalesce(jsonb_agg(due.id order by due.scheduled_for,due.id),'[]'::jsonb) from (
    select id,scheduled_for from private.billing_assignment_release_intents
    where state='pending' and scheduled_for<=clock_timestamp()
    order by scheduled_for,id limit p_limit
  ) due);
end;
$$;

create function public.process_billing_assignment_release_v1(p_intent_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare
  v_intent private.billing_assignment_release_intents%rowtype;
  v_assignment public.assignments%rowtype;
  v_classroom public.classrooms%rowtype;
  v_state text;
  v_notice text;
begin
  if not exists(select 1 from private.stripe_billing_settings where singleton and classroom_new_work_cutoff_enabled) then
    return 'disabled';
  end if;
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception using errcode='40001',message='billing_assignment_publication_requires_read_committed';
  end if;
  select * into v_intent from private.billing_assignment_release_intents
    where id=p_intent_id and state='pending' and scheduled_for<=clock_timestamp();
  if not found then return 'noop'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('assignment_submission:'||v_intent.assignment_id::text,0))
    or not pg_try_advisory_xact_lock(hashtextextended('pika-classroom-operation:'||v_intent.classroom_id::text,0)) then
    return 'busy';
  end if;
  begin
    select * into v_classroom from public.classrooms where id=v_intent.classroom_id for update nowait;
    select * into v_assignment from public.assignments where id=v_intent.assignment_id for update nowait;
  exception when lock_not_available then return 'busy';
  end;
  select * into v_intent from private.billing_assignment_release_intents where id=p_intent_id and state='pending' for update;
  if not found then return 'noop'; end if;

  if (not v_assignment.is_draft or v_assignment.released_at is not null)
    and v_assignment.classroom_id=v_intent.classroom_id then
    v_state:='superseded';
  elsif v_classroom.teacher_id is distinct from v_intent.subject_user_id or v_classroom.archived_at is not null
    or v_assignment.classroom_id is distinct from v_intent.classroom_id or v_assignment.blueprint_archived_at is not null then
    v_notice:='classroom_unavailable';
  elsif not pg_try_advisory_xact_lock(hashtextextended('account-plan-subject:'||v_intent.subject_user_id::text,20620260924)) then
    return 'busy';
  elsif not private.billing_classroom_can_start_work_v1(v_intent.classroom_id)
    or not private.billing_classroom_had_release_access_v1(v_intent.subject_user_id,v_intent.classroom_id,v_intent.scheduled_for) then
    v_notice:='access_unavailable';
  elsif v_assignment.due_at<v_intent.scheduled_for then
    v_notice:='deadline_before_schedule';
  else
    v_state:='released';
  end if;

  v_state:=coalesce(v_state,'suppressed');
  update private.billing_assignment_release_intents set state=v_state,notice_code=v_notice,processed_at=clock_timestamp()
    where id=p_intent_id;
  if v_state='released' then
    update public.assignments set is_draft=false,released_at=clock_timestamp() where id=v_assignment.id;
  end if;
  return v_state;
end;
$$;

revoke all on function private.billing_classroom_had_release_access_v1(uuid,uuid,timestamptz),
  private.assignment_release_schedule_payload_v1(private.billing_assignment_release_intents),
  private.lock_billing_assignment_release_owner_v1(uuid,uuid),
  private.apply_assignment_release_intent_for_owner_v1(uuid,uuid,uuid,boolean),
  private.guard_billing_assignment_release_intent_v1()
  from public,anon,authenticated,service_role;
revoke all on function public.get_assignment_release_states_for_owner_v1(uuid,uuid,uuid[]),
  public.schedule_assignment_for_billing_v1(uuid,uuid,timestamptz,uuid),
  public.cancel_assignment_release_for_owner_v1(uuid,uuid,uuid),
  public.publish_scheduled_assignment_for_owner_v1(uuid,uuid,uuid),
  public.list_due_billing_assignment_releases_v1(integer),public.process_billing_assignment_release_v1(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.get_assignment_release_states_for_owner_v1(uuid,uuid,uuid[]),
  public.schedule_assignment_for_billing_v1(uuid,uuid,timestamptz,uuid),
  public.cancel_assignment_release_for_owner_v1(uuid,uuid,uuid),
  public.publish_scheduled_assignment_for_owner_v1(uuid,uuid,uuid),
  public.list_due_billing_assignment_releases_v1(integer),public.process_billing_assignment_release_v1(uuid) to service_role;

-- The existing contextual and legacy discard paths share this locked function.
create or replace function public.discard_pristine_assignment_draft_atomic(
  p_assignment_id uuid,
  p_teacher_id uuid,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment public.assignments%rowtype;
  v_archived_at timestamptz;
  v_owner_id uuid;
begin
  if p_assignment_id is null
    or p_teacher_id is null
    or p_expected_updated_at is null
  then
    raise exception using errcode = '22023', message = 'invalid_assignment_discard_payload';
  end if;

  -- Requirement writes use this advisory lock before locking the Assignment.
  perform pg_advisory_xact_lock(
    hashtextextended('assignment_submission:' || p_assignment_id::text, 0)
  );

  select assignment.*
    into v_assignment
  from public.assignments assignment
  where assignment.id = p_assignment_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'assignment_not_found';
  end if;

  select classroom.teacher_id, classroom.archived_at
    into v_owner_id, v_archived_at
  from public.classrooms classroom
  where classroom.id = v_assignment.classroom_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'assignment_classroom_not_found';
  end if;
  if v_owner_id is distinct from p_teacher_id then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if v_archived_at is not null or v_assignment.blueprint_archived_at is not null then
    raise exception using errcode = '55000', message = 'assignment_archived';
  end if;

  if v_assignment.updated_at is distinct from p_expected_updated_at
    or v_assignment.is_draft is distinct from true
    or v_assignment.released_at is not null
    or exists (
      select 1 from private.billing_assignment_release_intents where assignment_id=p_assignment_id
    )
    or btrim(v_assignment.title) !~
      '^Untitled([[:space:]]+[0-9]{4}-[0-9]{2}-[0-9]{2}([[:space:]]+[0-9]{2}:[0-9]{2}:[0-9]{2})?|[[:space:]]*\([0-9]{4}-[0-9]{2}-[0-9]{2}[^)]*\))?$'
    or nullif(btrim(coalesce(v_assignment.instructions_markdown, '')), '') is not null
    or nullif(btrim(coalesce(v_assignment.description, '')), '') is not null
    or exists (
      select 1
      from public.assignment_submission_requirements requirement
      where requirement.assignment_id = p_assignment_id
    )
    or exists (
      select 1
      from public.assignment_docs document
      where document.assignment_id = p_assignment_id
    )
  then
    return jsonb_build_object(
      'discarded', false,
      'reason', 'draft_changed',
      'assignment', to_jsonb(v_assignment)
    );
  end if;

  delete from public.assignments assignment
  where assignment.id = p_assignment_id;

  return jsonb_build_object('discarded', true);
end;
$$;

-- Retained guarded schedules are also evidence of prior billing activity.
create or replace function public.billing_attest_live_target_v1(p_project_ref text, p_stripe_account text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.stripe_billing_settings settings
    where settings.singleton
      and not settings.sandbox_enabled
      and settings.live_project_ref = p_project_ref
      and settings.live_stripe_account = p_stripe_account
  )
  and not exists (select 1 from public.stripe_billing_offerings)
  and not exists (select 1 from public.stripe_billing_customers)
  and not exists (select 1 from public.stripe_billing_event_inbox)
  and not exists (select 1 from public.stripe_billing_subscription_audit)
  and not exists (select 1 from public.billing_trials)
  and not exists (select 1 from public.billing_account_access)
  and not exists (select 1 from public.billing_lifecycle_audit)
  and not exists (select 1 from private.billing_classroom_restrictions)
  and not exists (select 1 from private.billing_assignment_release_intents)
  and not exists (
    select 1 from public.account_plans plan where plan.management_source <> 'legacy'
  );
$$;

commit;
