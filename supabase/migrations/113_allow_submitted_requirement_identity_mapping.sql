-- Allow trusted Blueprint capture to attach stable lineage to requirement
-- definitions without weakening submitted-work immutability.

create or replace function public.guard_assignment_submission_requirement_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment_id uuid;
  v_artifact_id uuid;
  v_doc_id uuid;
begin
  if public.is_classroom_archive_maintenance_mode('restore')
    or public.is_classroom_archive_maintenance_mode('compaction') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'UPDATE' and old.assignment_id <> new.assignment_id then
    raise exception using
      errcode = '23514',
      message = 'assignment_requirement_move_forbidden';
  end if;

  -- The v2 Blueprint RPC is service-role-only and sets this transaction-local
  -- marker while it maps stable artifact identity. Permit only lineage columns
  -- to differ; all pedagogical fields, ownership, timestamps, and row identity
  -- must remain unchanged. Requiring the JWT role prevents callers from
  -- bypassing the guard by setting the custom GUC themselves.
  if tg_op = 'UPDATE'
    and current_setting('pika.identity_mapping', true) = 'on'
    and auth.role() = 'service_role'
    and (
      to_jsonb(new) - array[
        'artifact_id',
        'source_artifact_id',
        'source_blueprint_version_id'
      ]::text[]
    ) = (
      to_jsonb(old) - array[
        'artifact_id',
        'source_artifact_id',
        'source_blueprint_version_id'
      ]::text[]
    )
  then
    return new;
  end if;

  v_assignment_id := case when tg_op = 'DELETE' then old.assignment_id else new.assignment_id end;

  -- Parent assignment cascades are destructive operations, not requirement edits.
  if tg_op = 'DELETE' and not exists (
    select 1 from public.assignments where id = v_assignment_id
  ) then
    return old;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('assignment_submission:' || v_assignment_id::text, 0));

  if tg_op = 'DELETE' then
    for v_artifact_id in
      select artifact.id
      from public.assignment_submission_artifacts artifact
      where artifact.requirement_id = old.id
      order by artifact.id
      for update
    loop
      null;
    end loop;
  end if;

  for v_doc_id in
    select doc.id
    from public.assignment_docs doc
    where doc.assignment_id = v_assignment_id
    order by doc.id
    for update
  loop
    null;
  end loop;

  if exists (
    select 1
    from public.assignment_docs
    where assignment_id = v_assignment_id
      and is_submitted is true
  ) then
    raise exception using
      errcode = '23514',
      message = 'assignment_requirements_submitted_documents_immutable';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.guard_assignment_submission_requirement_mutation()
  from public, anon, authenticated, service_role;

comment on function public.guard_assignment_submission_requirement_mutation() is
  'Locks requirement definitions after submission, except service-role Blueprint lineage-only mapping.';
