-- Guard new publication through either assignment editor and direct writers.
-- Existing future schedules need conversion before enabling the cutoff.
begin;

create function private.guard_billing_assignment_publication_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_owner uuid;
  v_archived_at timestamptz;
  v_invoker_role text:=current_setting('role',true);
begin
  if new.is_draft or not exists(select 1 from private.stripe_billing_settings
    where singleton and classroom_new_work_cutoff_enabled) then
    return new;
  end if;
  if tg_op='UPDATE' and not old.is_draft and new.classroom_id=old.classroom_id
    and new.released_at is not distinct from old.released_at then
    return new;
  end if;
  -- The privileged native restore reconstitutes existing work.
  if public.is_classroom_archive_maintenance_mode('restore')
    and (v_invoker_role in ('postgres','service_role','supabase_admin')
      or (coalesce(v_invoker_role,'none')='none' and session_user in ('postgres','service_role','supabase_admin'))) then
    return new;
  end if;
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception using errcode='40001',message='billing_assignment_publication_requires_read_committed';
  end if;

  -- The contextual RPC already locks the classroom first. A direct update
  -- holds the assignment row, so use NOWAIT to avoid reversing that lock order.
  begin
    select teacher_id,archived_at into v_owner,v_archived_at from public.classrooms
      where id=new.classroom_id for share nowait;
  exception when lock_not_available then
    raise exception using errcode='PT409',message='billing_assignment_publication_busy';
  end;
  if not found then return new; end if; -- Preserve the native foreign-key error.
  if v_archived_at is not null or not private.billing_classroom_can_start_work_v1(new.classroom_id) then
    raise exception using errcode='PT403',message='billing_classroom_new_work_unavailable';
  end if;
  -- The shared access check already holds the plan lock. Until the durable
  -- worker is wired, a guarded schedule must stay a draft.
  if new.released_at>clock_timestamp() and exists(select 1 from public.account_plans
    where subject_user_id=v_owner and management_source in ('trial','billing')) then
    raise exception using errcode='PT403',message='billing_classroom_new_work_unavailable';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_billing_assignment_publication_v1() from public,anon,authenticated,service_role;

create trigger billing_assignment_publication_cutoff before insert or update of is_draft,released_at,classroom_id
on public.assignments for each row execute function private.guard_billing_assignment_publication_v1();

commit;
