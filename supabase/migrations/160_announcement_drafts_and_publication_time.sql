-- Keep announcement creation time distinct from the time students can see it.
alter table public.announcements
  add column is_draft boolean not null default false,
  add column published_at timestamptz default now();

-- Existing immediate announcements were published when created. Existing scheduled
-- announcements become visible at their scheduled boundary.
update public.announcements
set published_at = coalesce(scheduled_for, created_at);

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
