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

SYNC_READY_PATH="/tmp/pika-test-document-sync-ready"

cleanup() {
  docker exec "$DB_CONTAINER" rm -f "$SYNC_READY_PATH" >/dev/null 2>&1 || true
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
delete from public.classrooms
where id in (
  'f1000000-0000-4000-8000-000000000002',
  'f1000000-0000-4000-8000-000000000004'
);
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
insert into public.classrooms (
  id, teacher_id, title, class_code, archived_at
) values (
  'f1000000-0000-4000-8000-000000000004',
  'f1000000-0000-4000-8000-000000000001',
  'Archived test document ownership',
  'TDOCARC',
  clock_timestamp()
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

insert into public.tests (
  id, classroom_id, title, status, created_by, documents
) values (
  'f1000000-0000-4000-8000-000000000005',
  'f1000000-0000-4000-8000-000000000004',
  'Archived test',
  'draft',
  'f1000000-0000-4000-8000-000000000001',
  '[{
    "id":"archived-doc",
    "title":"Archived reference",
    "source":"link",
    "url":"https://example.com/archived",
    "snapshot_path":"link-docs/f1000000-0000-4000-8000-000000000001/test/archived/snapshots/current",
    "snapshot_content_type":"text/html",
    "synced_at":"2026-07-23T12:00:00Z"
  }]'::jsonb
);

insert into public.course_blueprints (
  id, teacher_id, title
) values (
  'f1000000-0000-4000-8000-000000000006',
  'f1000000-0000-4000-8000-000000000001',
  'Snapshot ownership blueprint'
);
insert into public.course_blueprint_assessments (
  id, course_blueprint_id, assessment_type, title, documents
) values (
  'f1000000-0000-4000-8000-000000000007',
  'f1000000-0000-4000-8000-000000000006',
  'test',
  'Blueprint test',
  '[{
    "id":"blueprint-doc",
    "title":"Blueprint reference",
    "source":"link",
    "url":"https://example.com/blueprint",
    "snapshot_path":"link-docs/f1000000-0000-4000-8000-000000000001/test/blueprint/snapshots/current"
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
\! touch /tmp/pika-test-document-sync-ready
select pg_sleep(1);
commit;
SQL
sync_pid=$!

for _attempt in $(seq 1 100); do
  if docker exec "$DB_CONTAINER" test -f "$SYNC_READY_PATH"; then
    break
  fi
  if ! kill -0 "$sync_pid" 2>/dev/null; then
    wait "$sync_pid"
    echo "Snapshot sync exited before acquiring the test-row lock." >&2
    exit 3
  fi
  sleep 0.05
done
if ! docker exec "$DB_CONTAINER" test -f "$SYNC_READY_PATH"; then
  echo "Timed out waiting for snapshot sync to acquire the test-row lock." >&2
  exit 3
fi

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
  v_lease_token uuid := 'f1000000-0000-4000-8000-000000000008';
  v_result jsonb;
begin
  delete from public.tests
  where id = 'f1000000-0000-4000-8000-000000000005';
  if exists (
    select 1
    from public.test_document_snapshot_storage_cleanup
    where storage_path =
      'link-docs/f1000000-0000-4000-8000-000000000001/test/archived/snapshots/current'
  ) then
    raise exception 'Archived compaction-style deletion queued a preserved snapshot';
  end if;

  perform public.enqueue_test_document_snapshot_storage_cleanup_path(
    'link-docs/f1000000-0000-4000-8000-000000000001/test/blueprint/snapshots/current',
    0
  );
  select count(*) into v_claimed
  from public.claim_test_document_snapshot_storage_cleanup_path(
    'link-docs/f1000000-0000-4000-8000-000000000001/test/blueprint/snapshots/current',
    gen_random_uuid(),
    120
  );
  if v_claimed <> 0 then
    raise exception 'Blueprint-owned snapshot became cleanup eligible';
  end if;

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
    'link-docs/f1000000-0000-4000-8000-000000000001/test/doc-1/snapshots/claimed',
    0
  );
  select count(*) into v_claimed
  from public.claim_test_document_snapshot_storage_cleanup_path(
    'link-docs/f1000000-0000-4000-8000-000000000001/test/doc-1/snapshots/claimed',
    v_lease_token,
    120
  );
  if v_claimed <> 1 then
    raise exception 'Expected the provisional snapshot cleanup lease';
  end if;
  begin
    perform public.sync_test_document_snapshot_atomic(
      'f1000000-0000-4000-8000-000000000001',
      'f1000000-0000-4000-8000-000000000003',
      'doc-1',
      'https://example.com/reference',
      'link-docs/f1000000-0000-4000-8000-000000000001/test/doc-1/snapshots/claimed',
      'text/html',
      '2026-07-23T14:00:00Z'
    );
    raise exception 'Snapshot attachment bypassed an active cleanup lease';
  exception
    when serialization_failure then
      if sqlerrm <> 'snapshot_cleanup_in_progress' then
        raise;
      end if;
  end;

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
