-- Phase 1 only: local identity metadata, no Pal provisioning or event cutover.
-- 166/167 belong to the separate classroom-creation worktree.
-- Enrollment UUIDs survive archive replay and migration 164 removal. References
-- are random, persisted once, and independent of every application secret.
-- This ledger is operational evidence, never an archive resource or cascade
-- child. Old archive bytes must not overwrite a removed/purged generation.
create table private.pal_membership_generations (
  generation_id uuid primary key,
  scope_digest text,
  pal_reference text not null unique default
    ('pika-membership-v1-' || replace(gen_random_uuid()::text, '-', '')),
  state text not null check (state in ('active', 'removed', 'purged')),
  check (pal_reference ~ '^pika-membership-v1-[0-9a-f]{32}$'),
  check ((state = 'purged' and scope_digest is null)
    or (state <> 'purged' and scope_digest is not null and scope_digest ~ '^[0-9a-f]{64}$'))
);
create index pal_membership_generations_scope on private.pal_membership_generations(scope_digest);
alter table private.pal_membership_generations enable row level security;
revoke all on private.pal_membership_generations from public, anon, authenticated, service_role;

create table private.pal_membership_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false
);
insert into private.pal_membership_settings (singleton) values (true);
alter table private.pal_membership_settings enable row level security;
revoke all on private.pal_membership_settings from public, anon, authenticated, service_role;

-- The internal digest locates retained cleanup metadata after enrollment goes
-- away. It is not the provider identity and never leaves the database.
create function private.pal_membership_scope(p_classroom_id uuid, p_student_id uuid)
returns text language sql immutable strict set search_path = '' as $$
  select encode(extensions.digest(
    'pika-membership-scope-v1:' || p_classroom_id::text || ':' || p_student_id::text,
    'sha256'), 'hex');
$$;
revoke all on function private.pal_membership_scope(uuid,uuid) from public, anon, authenticated, service_role;

-- Refuse ambiguous historical identity rather than choosing one side.
insert into private.pal_membership_generations (generation_id, scope_digest, state)
select id, private.pal_membership_scope(classroom_id, student_id), 'active'
from public.classroom_enrollments;
insert into private.pal_membership_generations (generation_id, scope_digest, state)
select removed_enrollment_id, private.pal_membership_scope(classroom_id, removed_student_id), 'removed'
from public.classroom_roster where removed_at is not null;

create function private.guard_pal_membership_evidence()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'pal_membership_evidence_retained';
  end if;
  if new.generation_id is distinct from old.generation_id
    or new.pal_reference is distinct from old.pal_reference
    or not (
      (new.state = old.state and new.scope_digest is not distinct from old.scope_digest)
      or (old.state = 'active' and new.state = 'removed' and new.scope_digest = old.scope_digest)
      or (old.state = 'removed' and new.state = 'purged' and new.scope_digest is null)
    )
  then raise exception using errcode = '55000', message = 'pal_membership_identity_immutable'; end if;
  return new;
end;
$$;
create trigger guard_pal_membership_evidence before update or delete
  on private.pal_membership_generations for each row execute function private.guard_pal_membership_evidence();
revoke all on function private.guard_pal_membership_evidence() from public, anon, authenticated, service_role;

-- Internal registration is safe for old archives that predate this migration:
-- no Pal profile could have been issued for their unknown generations. Known
-- IDs must keep the exact binding and state, even under restore maintenance.
create function private.register_pal_membership(
  p_generation_id uuid, p_classroom_id uuid, p_student_id uuid, p_state text
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_scope text := private.pal_membership_scope(p_classroom_id, p_student_id);
  v_identity private.pal_membership_generations%rowtype;
begin
  insert into private.pal_membership_generations(generation_id, scope_digest, state)
  values (p_generation_id, v_scope, p_state) on conflict (generation_id) do nothing;
  select * into strict v_identity from private.pal_membership_generations
    where generation_id = p_generation_id for update;
  if v_identity.scope_digest is distinct from v_scope or v_identity.state = 'purged'
    or (p_state = 'active' and v_identity.state <> 'active')
  then raise exception using errcode = '55000', message = 'pal_membership_generation_closed'; end if;
  if p_state = 'removed' and v_identity.state = 'active' then
    update private.pal_membership_generations set state = 'removed' where generation_id = p_generation_id;
  end if;
end;
$$;
revoke all on function private.register_pal_membership(uuid,uuid,uuid,text) from public, anon, authenticated, service_role;

create function private.track_pal_membership_enrollment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    perform private.try_lock_classroom_membership_change(old.classroom_id, old.student_id);
    if not coalesce(public.is_classroom_archive_maintenance_mode('compaction'), false) then
      perform private.register_pal_membership(old.id, old.classroom_id, old.student_id, 'removed');
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and (new.id is distinct from old.id
    or new.classroom_id is distinct from old.classroom_id
    or new.student_id is distinct from old.student_id)
  then raise exception using errcode = '55000', message = 'pal_membership_generation_immutable'; end if;
  perform private.try_lock_classroom_membership_change(new.classroom_id, new.student_id);
  perform private.register_pal_membership(new.id, new.classroom_id, new.student_id, 'active');
  return new;
end;
$$;
-- Register only successful inserts: BEFORE INSERT also runs for discarded
-- ON CONFLICT retries and would leave phantom generations behind.
create trigger track_pal_membership_enrollment_insert
  after insert on public.classroom_enrollments
  for each row execute function private.track_pal_membership_enrollment();
create trigger track_pal_membership_enrollment_change
  before update of id, classroom_id, student_id or delete on public.classroom_enrollments
  for each row execute function private.track_pal_membership_enrollment();
revoke all on function private.track_pal_membership_enrollment() from public, anon, authenticated, service_role;

create function private.track_pal_removed_roster()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.removed_at is not null then
    perform private.try_lock_classroom_membership_change(new.classroom_id, new.removed_student_id);
    perform private.register_pal_membership(
      new.removed_enrollment_id, new.classroom_id, new.removed_student_id, 'removed');
  end if;
  return new;
end;
$$;
create trigger track_pal_removed_roster after insert or update on public.classroom_roster
  for each row execute function private.track_pal_removed_roster();
revoke all on function private.track_pal_removed_roster() from public, anon, authenticated, service_role;

-- Only the authenticated Pika server calls this with its session's student ID.
-- There is no browser RPC privilege, token mint, provisioning, or legacy fallback.
create function public.resolve_pal_membership(p_student_id uuid, p_classroom_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_reference text;
begin
  if not coalesce((select enabled from private.pal_membership_settings where singleton), false) then
    return jsonb_build_object('status', 'disabled');
  end if;
  perform private.try_lock_classroom_membership_change(p_classroom_id, p_student_id);
  if exists (select 1 from public.student_purge_fences
      where classroom_id = p_classroom_id and student_id = p_student_id)
    or exists (select 1 from public.classroom_purge_fences where classroom_id = p_classroom_id)
    or exists (select 1 from public.cold_classroom_purge_fences where classroom_id = p_classroom_id)
    or exists (select 1 from public.classroom_roster where classroom_id = p_classroom_id
      and removed_student_id = p_student_id and removed_at is not null)
  then return jsonb_build_object('status', 'forbidden'); end if;
  select identity.pal_reference into v_reference
  from public.classroom_enrollments enrollment
  join public.classrooms classroom on classroom.id = enrollment.classroom_id
  join public.users student on student.id = enrollment.student_id
  join private.pal_membership_generations identity on identity.generation_id = enrollment.id
    and identity.scope_digest = private.pal_membership_scope(enrollment.classroom_id, enrollment.student_id)
  where enrollment.classroom_id = p_classroom_id and enrollment.student_id = p_student_id
    and classroom.archived_at is null and student.role = 'student' and identity.state = 'active';
  if v_reference is null then return jsonb_build_object('status', 'forbidden'); end if;
  return jsonb_build_object('status', 'active', 'learner_id', v_reference);
end;
$$;
revoke all on function public.resolve_pal_membership(uuid,uuid) from public, anon, authenticated;
grant execute on function public.resolve_pal_membership(uuid,uuid) to service_role;

comment on table private.pal_membership_generations is
  'Immutable membership generation and opaque Pal identity; retained outside archives. Purged is a future verified-cleanup boundary, not a worker or deletion receipt.';
