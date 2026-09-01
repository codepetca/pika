-- Student inline submissions and assessment materials must never bypass Pika's
-- application authorization. The application serves these objects through
-- authenticated, ownership-aware routes backed by the service-role client.

do $private_storage_readiness$
begin
  if exists (
    select 1
    from storage.objects stored
    where stored.bucket_id in ('submission-images', 'test-documents')
  ) and not exists (
    select 1
    from public.managed_storage_settings settings
    where settings.singleton and settings.mode = 'enforced'
  ) then
    raise exception using errcode = '55000',
      message = 'private_student_storage_requires_managed_storage_enforcement';
  end if;

  if exists (
    select 1
    from storage.objects stored
    left join public.managed_storage_objects managed
      on managed.storage_bucket = stored.bucket_id
     and managed.storage_path = stored.name
    where stored.bucket_id in ('submission-images', 'test-documents')
      and (
        managed.id is null
        or (stored.bucket_id = 'submission-images'
          and managed.status not in ('verified', 'ready'))
        or (stored.bucket_id = 'test-documents' and managed.status <> 'ready')
      )
  ) then
    raise exception using errcode = '55000',
      message = 'private_student_storage_contains_unsettled_legacy_objects';
  end if;
end;
$private_storage_readiness$;

update storage.buckets
set public = false,
    updated_at = now()
where id in ('submission-images', 'test-documents');

drop policy if exists "Allow public read access" on storage.objects;
drop policy if exists "Allow public read access for test documents" on storage.objects;
drop policy if exists "Allow authenticated uploads" on storage.objects;
drop policy if exists "Allow owner deletes" on storage.objects;
drop policy if exists "Allow authenticated uploads for test documents" on storage.objects;
drop policy if exists "Allow owner deletes for test documents" on storage.objects;
