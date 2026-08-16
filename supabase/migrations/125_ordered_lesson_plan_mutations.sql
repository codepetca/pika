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
