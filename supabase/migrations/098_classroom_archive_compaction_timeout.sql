-- Give the service-only atomic compaction finalizer enough time for large classrooms.

alter function public.complete_classroom_archive_compaction(
  uuid, uuid, jsonb, jsonb
) set statement_timeout = '60s';

comment on function public.complete_classroom_archive_compaction(
  uuid, uuid, jsonb, jsonb
) is 'Atomically verifies and cold-compacts one archived classroom; service role only, with a function-scoped 60-second statement timeout.';
