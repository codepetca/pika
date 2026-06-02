alter table public.classrooms
  add column if not exists join_policy text not null default 'roster';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'classrooms_join_policy_check'
  ) then
    alter table public.classrooms
      add constraint classrooms_join_policy_check
      check (join_policy in ('roster', 'open_join'));
  end if;
end $$;

alter table public.classroom_roster
  add column if not exists join_source text not null default 'manual';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'classroom_roster_join_source_check'
  ) then
    alter table public.classroom_roster
      add constraint classroom_roster_join_source_check
      check (join_source in ('manual', 'csv', 'open_join'));
  end if;
end $$;

comment on column public.classrooms.join_policy is
  'Student join access mode: roster requires a matching classroom_roster email; open_join allows verified students with code/link to self-roster.';

comment on column public.classroom_roster.join_source is
  'How the roster row was created: manual teacher entry, csv upload, or open_join self-enrollment.';
