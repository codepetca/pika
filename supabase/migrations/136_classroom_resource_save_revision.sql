begin;

alter table public.classroom_resources
  add column save_revision bigint not null default 0;

create or replace function public.reject_stale_classroom_resource_save()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.save_revision < old.save_revision then
    return null;
  end if;

  return new;
end;
$$;

revoke all on function public.reject_stale_classroom_resource_save() from public;

create trigger reject_stale_classroom_resource_save
  before update on public.classroom_resources
  for each row
  execute function public.reject_stale_classroom_resource_save();

comment on column public.classroom_resources.save_revision is
  'Browser-assigned monotonic revision used to reject out-of-order autosaves and unload beacons.';

comment on function public.reject_stale_classroom_resource_save() is
  'Silently rejects a classroom resource write when a newer browser save revision is already stored.';

commit;
