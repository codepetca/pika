-- Allow synced external link snapshots to store sanitized HTML pages.

update storage.buckets
set allowed_mime_types = (
  select array_agg(distinct mime_type order by mime_type)
  from unnest(coalesce(allowed_mime_types, array[]::text[]) || array['text/html']) as mime_type
)
where id = 'test-documents';
