-- Configured assignment attachments are expected, but a student may explicitly
-- submit without a missing attachment after the application confirmation.
-- Invalid or inaccessible artifacts remain database-level submission blockers.

create or replace function private.validate_assignment_submission_requirements(p_doc public.assignment_docs)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.assignment_submission_requirements r
    join public.assignment_submission_artifacts a
      on a.requirement_id = r.id
      and a.assignment_doc_id = p_doc.id
      and a.student_id = p_doc.student_id
      and a.type = r.type
    where r.assignment_id = p_doc.assignment_id
      and a.validation_status in ('invalid', 'inaccessible')
      and case
        when r.type = 'image' then
          coalesce(nullif(btrim(a.storage_path), ''), nullif(btrim(a.url), '')) is not null
        else nullif(btrim(coalesce(a.url, '')), '') is not null
      end
  ) then
    raise exception using
      errcode = '23514',
      message = 'assignment_submission_requirements_incomplete';
  end if;
end;
$$;

revoke all on function private.validate_assignment_submission_requirements(public.assignment_docs)
  from public, anon, authenticated, service_role;

comment on function private.validate_assignment_submission_requirements(public.assignment_docs) is
  'Blocks submission only when a present assignment attachment is invalid or inaccessible; missing configured attachments require application acknowledgement.';
