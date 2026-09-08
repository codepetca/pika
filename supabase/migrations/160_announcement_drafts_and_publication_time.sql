-- Keep announcement creation time distinct from the time students can see it.
alter table public.announcements
  add column is_draft boolean not null default false,
  add column published_at timestamptz default now();

-- Existing immediate announcements were published when created. Existing scheduled
-- announcements become visible at their scheduled boundary. Preserve the historical
-- edit timestamp while backfilling this metadata: the table's BEFORE UPDATE trigger
-- otherwise rewrites updated_at for every existing announcement.
create temporary table announcement_publication_backfill_timestamps
on commit drop
as
select id, updated_at
from public.announcements;

alter table public.announcements
  disable trigger announcements_updated_at_trigger;

update public.announcements
set published_at = coalesce(scheduled_for, created_at);

alter table public.announcements
  enable trigger announcements_updated_at_trigger;

do $$
begin
  if exists (
    select 1
    from public.announcements as announcement
    join announcement_publication_backfill_timestamps as original using (id)
    where announcement.updated_at is distinct from original.updated_at
  ) then
    raise exception 'Announcement publication backfill changed updated_at';
  end if;
end
$$;

alter table public.announcements
  add constraint announcements_publication_state_check
  check (
    (is_draft and scheduled_for is null and published_at is null)
    or
    (
      not is_draft
      and published_at is not null
      and (scheduled_for is null or published_at = scheduled_for)
    )
  );

create index idx_announcements_publication
  on public.announcements(classroom_id, is_draft, published_at desc);
