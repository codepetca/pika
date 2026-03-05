-- Add teacher-managed test documents and storage bucket for uploaded files

alter table public.tests
  add column if not exists documents jsonb not null default '[]'::jsonb;

comment on column public.tests.documents is
  'Teacher-managed list of allowed test documents. JSON array of {id,title,source,url?,content?}.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'test-documents',
  'test-documents',
  true,
  26214400, -- 25MB
  array[
    'application/pdf',
    'text/plain',
    'text/markdown',
    'text/csv',
    'application/json',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do nothing;

drop policy if exists "Allow authenticated uploads for test documents" on storage.objects;
create policy "Allow authenticated uploads for test documents"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'test-documents');

drop policy if exists "Allow public read access for test documents" on storage.objects;
create policy "Allow public read access for test documents"
on storage.objects
for select
to public
using (bucket_id = 'test-documents');

drop policy if exists "Allow owner deletes for test documents" on storage.objects;
create policy "Allow owner deletes for test documents"
on storage.objects
for delete
to authenticated
using (bucket_id = 'test-documents' and (storage.foldername(name))[1] = auth.uid()::text);
