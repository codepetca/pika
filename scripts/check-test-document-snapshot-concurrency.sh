#!/usr/bin/env bash
set -euo pipefail

DB_CONTAINER="$(docker ps --filter 'name=^supabase_db_pika$' --format '{{.Names}}' | head -n 1)"
if [[ -z "$DB_CONTAINER" ]]; then
  DB_CONTAINER="$(docker ps --filter 'name=supabase_db_' --format '{{.Names}}' | head -n 1)"
fi
if [[ -z "$DB_CONTAINER" ]]; then
  echo "Supabase database container is not running." >&2
  exit 2
fi

cleanup() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
delete from public.classrooms
where id = 'f1000000-0000-4000-8000-000000000002';
delete from public.users
where id in (
  'f1000000-0000-4000-8000-000000000001',
  'f1000000-0000-4000-8000-000000000009'
);
delete from public.test_document_snapshot_storage_cleanup
where storage_path like 'link-docs/f1000000-0000-4000-8000-000000000001/%';
SQL
}
trap cleanup EXIT
cleanup

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into public.users (id, email, role) values
  ('f1000000-0000-4000-8000-000000000001', 'test-doc-owner@example.test', 'teacher'),
  ('f1000000-0000-4000-8000-000000000009', 'test-doc-other@example.test', 'teacher');

insert into public.classrooms (id, teacher_id, title, class_code) values (
  'f1000000-0000-4000-8000-000000000002',
  'f1000000-0000-4000-8000-000000000001',
  'Test document concurrency',
  'TDOC106'
);

insert into public.tests (
  id, classroom_id, title, status, created_by, documents
) values (
  'f1000000-0000-4000-8000-000000000003',
  'f1000000-0000-4000-8000-000000000002',
  'Concurrent test',
  'draft',
  'f1000000-0000-4000-8000-000000000001',
  '[{
    "id":"doc-1",
    "title":"Reference",
    "source":"link",
    "url":"https://example.com/reference",
    "snapshot_path":"link-docs/f1000000-0000-4000-8000-000000000001/test/doc-1/snapshots/old",
    "snapshot_content_type":"text/html",
    "synced_at":"2026-07-23T12:00:00Z"
  }]'::jsonb
);

insert into public.test_document_snapshot_storage_cleanup (
  storage_path, status, next_attempt_at
) values (
  'link-docs/f1000000-0000-4000-8000-000000000001/test/doc-1/snapshots/new',
  'pending',
  clock_timestamp() + interval '15 minutes'
);
SQL

docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
select public.sync_test_document_snapshot_atomic(
  'f1000000-0000-4000-8000-000000000001',
  'f1000000-0000-4000-8000-000000000003',
  'doc-1',
  'https://example.com/reference',
  'link-docs/f1000000-0000-4000-8000-000000000001/test/doc-1/snapshots/new',
  'text/html',
  '2026-07-23T13:00:00Z'
);
select pg_sleep(1);
commit;
SQL
sync_pid=$!

sleep 0.2
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
set lock_timeout = '5s';
do $$
begin
  perform public.update_test_documents_atomic(
    'f1000000-0000-4000-8000-000000000001',
    'f1000000-0000-4000-8000-000000000003',
    'draft',
    '[{
      "id":"doc-1",
      "title":"Reference",
      "source":"link",
      "url":"https://example.com/reference",
      "snapshot_path":"link-docs/f1000000-0000-4000-8000-000000000001/test/doc-1/snapshots/old",
      "snapshot_content_type":"text/html",
      "synced_at":"2026-07-23T12:00:00Z"
    }]'::jsonb,
    '[]'::jsonb,
    false, '', false, 'draft', false, false
  );
  raise exception 'Stale document authoring write unexpectedly succeeded';
exception
  when serialization_failure then
    if sqlerrm <> 'document_conflict' then
      raise;
    end if;
end;
$$;
SQL
wait "$sync_pid"

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
do $$
declare
  v_claimed integer;
  v_documents jsonb;
  v_result jsonb;
begin
  select documents into strict v_documents
  from public.tests
  where id = 'f1000000-0000-4000-8000-000000000003';

  if v_documents #>> '{0,snapshot_path}'
    <> 'link-docs/f1000000-0000-4000-8000-000000000001/test/doc-1/snapshots/new'
  then
    raise exception 'Snapshot sync did not win the serialized race: %', v_documents;
  end if;

  if exists (
    select 1
    from public.test_document_snapshot_storage_cleanup
    where storage_path =
      'link-docs/f1000000-0000-4000-8000-000000000001/test/doc-1/snapshots/new'
  ) then
    raise exception 'Committed snapshot retained provisional cleanup evidence';
  end if;

  if not exists (
    select 1
    from public.test_document_snapshot_storage_cleanup
    where storage_path =
      'link-docs/f1000000-0000-4000-8000-000000000001/test/doc-1/snapshots/old'
  ) then
    raise exception 'Superseded snapshot was not durably queued';
  end if;

  perform public.enqueue_test_document_snapshot_storage_cleanup_path(
    'link-docs/f1000000-0000-4000-8000-000000000001/test/doc-1/snapshots/new',
    0
  );
  select count(*) into v_claimed
  from public.claim_test_document_snapshot_storage_cleanup(
    gen_random_uuid(), 10, 120
  );
  if v_claimed <> 1 then
    raise exception 'Expected only the unreferenced old snapshot claim, got %', v_claimed;
  end if;

  v_result := public.update_test_documents_atomic(
    'f1000000-0000-4000-8000-000000000001',
    'f1000000-0000-4000-8000-000000000003',
    'draft',
    v_documents,
    '[]'::jsonb,
    false, '', false, 'draft', false, false
  );
  if v_result->'cleanup_paths' <> jsonb_build_array(
    'link-docs/f1000000-0000-4000-8000-000000000001/test/doc-1/snapshots/new'
  ) then
    raise exception 'Document removal returned unexpected cleanup paths: %', v_result;
  end if;

  if not exists (
    select 1
    from public.test_document_snapshot_storage_cleanup
    where storage_path =
      'link-docs/f1000000-0000-4000-8000-000000000001/test/doc-1/snapshots/new'
  ) then
    raise exception 'Removed snapshot was not durably queued';
  end if;

  begin
    perform public.update_test_documents_atomic(
      'f1000000-0000-4000-8000-000000000009',
      'f1000000-0000-4000-8000-000000000003',
      'draft',
      '[]'::jsonb,
      '[]'::jsonb,
      false, '', false, 'draft', false, false
    );
    raise exception 'Non-owner document write unexpectedly succeeded';
  exception
    when insufficient_privilege then
      if sqlerrm <> 'forbidden' then
        raise;
      end if;
  end;
end;
$$;
SQL

echo "Test document snapshot concurrency checks passed."
