-- Student inline submissions and assessment materials must never bypass Pika's
-- application authorization. The application serves these objects through
-- authenticated, ownership-aware routes backed by the service-role client.

update storage.buckets
set public = false,
    updated_at = now()
where id in ('submission-images', 'test-documents');

drop policy if exists "Allow public read access" on storage.objects;
drop policy if exists "Allow public read access for test documents" on storage.objects;

comment on table storage.buckets is
  'Supabase Storage buckets. Pika student submissions and Test materials are private and delivered only after application authorization.';
