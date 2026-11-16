-- Remove the live admission grant only as part of deleting its local account.
begin;

create function private.guard_classroom_admission_grant_v1()
returns trigger language plpgsql volatile set search_path = '' set row_security = off as $function$
begin
  if tg_op = 'DELETE' then
    -- The foreign key deletes the grant after the parent row is gone.
    if not exists (select 1 from public.users where id = old.user_id) then
      return old;
    end if;
  end if;

  raise exception using errcode = '55000', message = 'classroom_admission_record_immutable';
end
$function$;

revoke all on function private.guard_classroom_admission_grant_v1()
  from public, anon, authenticated, service_role;

create or replace trigger classroom_admission_grant_immutable
before update or delete on private.classroom_experience_admission_grants
for each row execute function private.guard_classroom_admission_grant_v1();

alter table private.classroom_experience_admission_grants
  drop constraint classroom_experience_admission_grants_user_id_fkey,
  add constraint classroom_experience_admission_grants_user_id_fkey
    foreign key (user_id) references public.users(id) on delete cascade;

-- Existing classroom ownership FKs can cascade through other learners' work.
-- Read hot and cold ownership together without taking classroom row locks.
create function private.guard_admitted_account_classroom_ownership_v1()
returns trigger language plpgsql volatile security definer
set search_path = '' set row_security = off as $function$
begin
  if exists (select 1 from private.classroom_experience_admission_grants where user_id = old.id)
    and exists (
      select 1 from public.classrooms where teacher_id = old.id
      union all
      select 1 from public.classroom_cold_tombstones where teacher_id = old.id
    ) then
    raise exception using errcode = '55000', message = 'admitted_account_owns_classrooms';
  end if;
  return old;
end
$function$;

revoke all on function private.guard_admitted_account_classroom_ownership_v1()
  from public, anon, authenticated, service_role;

create trigger classroom_admission_preserve_owned_classrooms
before delete on public.users
for each row execute function private.guard_admitted_account_classroom_ownership_v1();

commit;
