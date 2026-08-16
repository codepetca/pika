-- Preserve teacher intent when lesson-plan requests complete out of order.

create table public.lesson_plan_mutation_heads (
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  date date not null,
  client_id uuid not null,
  last_sequence bigint not null check (last_sequence > 0),
  updated_at timestamptz not null default now(),
  primary key (classroom_id, date, client_id)
);

alter table public.lesson_plan_mutation_heads enable row level security;

revoke all on table public.lesson_plan_mutation_heads from public, anon, authenticated;
grant select, insert, update, delete on table public.lesson_plan_mutation_heads to service_role;

create trigger lesson_plan_mutation_head_purge_fence
before insert or update or delete on public.lesson_plan_mutation_heads
for each row execute function public.reject_classroom_resource_change_during_purge(
  'classrooms', 'classroom_id'
);

-- Migration 118 predates mutation heads. Preserve its inventory implementation
-- behind a private helper and extend the public result with an exact database
-- count so purge confirmation, begin-time fencing, and durable operation counts
-- all use the same value without PostgREST pagination.
alter function public.get_hot_archived_classroom_purge_inventory(uuid, uuid)
  rename to get_hot_archived_classroom_purge_inventory_without_lesson_heads;
alter function public.get_hot_archived_classroom_purge_inventory_without_lesson_heads(
  uuid, uuid
) set schema private;

revoke all on function private.get_hot_archived_classroom_purge_inventory_without_lesson_heads(
  uuid, uuid
) from public, anon, authenticated, service_role;

create function public.get_hot_archived_classroom_purge_inventory(
  p_teacher_id uuid,
  p_classroom_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inventory jsonb;
  v_operational_counts jsonb;
  v_operational_digest text;
begin
  v_inventory := private.get_hot_archived_classroom_purge_inventory_without_lesson_heads(
    p_teacher_id,
    p_classroom_id
  );
  if not coalesce((v_inventory->>'ok')::boolean, false) then
    return v_inventory;
  end if;

  v_operational_counts := coalesce(
    v_inventory->'operational_counts',
    '{}'::jsonb
  ) || jsonb_build_object(
    'lesson_plan_mutation_heads',
    (
      select count(*)::integer
      from public.lesson_plan_mutation_heads
      where classroom_id = p_classroom_id
    )
  );
  v_operational_digest := encode(extensions.digest(
    convert_to(v_operational_counts::text, 'UTF8'), 'sha256'
  ), 'hex');

  return v_inventory || jsonb_build_object(
    'operational_counts', v_operational_counts,
    'operational_inventory_sha256', v_operational_digest
  );
end;
$$;

revoke all on function public.get_hot_archived_classroom_purge_inventory(
  uuid, uuid
) from public, anon, authenticated;
grant execute on function public.get_hot_archived_classroom_purge_inventory(
  uuid, uuid
) to service_role;

create or replace function public.apply_ordered_lesson_plan_mutation(
  p_classroom_id uuid,
  p_date date,
  p_content_markdown text,
  p_content jsonb,
  p_delete boolean,
  p_client_id uuid,
  p_sequence bigint
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_accepted boolean := false;
  v_lesson_plan public.lesson_plans%rowtype;
begin
  if p_sequence <= 0 then
    raise exception 'Lesson-plan mutation sequence must be positive';
  end if;

  insert into public.lesson_plan_mutation_heads (
    classroom_id,
    date,
    client_id,
    last_sequence,
    updated_at
  ) values (
    p_classroom_id,
    p_date,
    p_client_id,
    p_sequence,
    now()
  )
  on conflict (classroom_id, date, client_id) do update
  set last_sequence = excluded.last_sequence,
      updated_at = now()
  where public.lesson_plan_mutation_heads.last_sequence < excluded.last_sequence
  returning true into v_accepted;

  if not coalesce(v_accepted, false) then
    select * into v_lesson_plan
    from public.lesson_plans
    where classroom_id = p_classroom_id
      and date = p_date;

    return jsonb_build_object(
      'applied', false,
      'lesson_plan', case when found then to_jsonb(v_lesson_plan) else null end
    );
  end if;

  if p_delete then
    delete from public.lesson_plans
    where classroom_id = p_classroom_id
      and date = p_date;

    return jsonb_build_object('applied', true, 'lesson_plan', null);
  end if;

  insert into public.lesson_plans (
    classroom_id,
    date,
    content_markdown,
    content,
    updated_at
  ) values (
    p_classroom_id,
    p_date,
    p_content_markdown,
    p_content,
    now()
  )
  on conflict (classroom_id, date) do update
  set content_markdown = excluded.content_markdown,
      content = excluded.content,
      updated_at = excluded.updated_at
  returning * into v_lesson_plan;

  return jsonb_build_object(
    'applied', true,
    'lesson_plan', to_jsonb(v_lesson_plan)
  );
end;
$$;

revoke all on function public.apply_ordered_lesson_plan_mutation(
  uuid, date, text, jsonb, boolean, uuid, bigint
) from public, anon, authenticated;
grant execute on function public.apply_ordered_lesson_plan_mutation(
  uuid, date, text, jsonb, boolean, uuid, bigint
) to service_role;

comment on table public.lesson_plan_mutation_heads is
  'Per-browser-session ordering fence for teacher lesson-plan mutations.';

comment on function public.apply_ordered_lesson_plan_mutation(
  uuid, date, text, jsonb, boolean, uuid, bigint
) is
  'Atomically rejects stale lesson-plan mutations before applying delete or upsert.';
