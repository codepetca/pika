-- Backfill legacy rows after writers are revision-stamped, then validate constraints.

update public.test_responses
set revision = 1
where revision is null;

-- Existing active runs have no trustworthy ordering baseline. Fail them closed
-- before assigning revision snapshots so they cannot overwrite newer teacher work.
update public.test_ai_grading_run_items item
set
  status = 'failed',
  next_retry_at = null,
  last_error_code = 'revision_baseline_unavailable',
  last_error_message = 'Retry this response in a new AI grading run',
  completed_at = now()
from public.test_ai_grading_runs run
where run.id = item.run_id
  and run.status in ('queued', 'running')
  and item.status in ('queued', 'processing');

update public.test_ai_grading_runs run
set
  status = 'failed',
  processed_count = (
    select count(*)::integer
    from public.test_ai_grading_run_items item
    where item.run_id = run.id and item.status in ('completed', 'failed')
  ),
  completed_count = (
    select count(*)::integer
    from public.test_ai_grading_run_items item
    where item.run_id = run.id and item.status = 'completed'
  ),
  failed_count = (
    select count(*)::integer
    from public.test_ai_grading_run_items item
    where item.run_id = run.id and item.status = 'failed'
  ),
  lease_token = null,
  lease_expires_at = null,
  completed_at = now(),
  error_samples_json = jsonb_build_array(jsonb_build_object(
    'student_id', null,
    'code', 'revision_baseline_unavailable',
    'message', 'Start a new AI grading run after the grading safety upgrade'
  ))
where run.status in ('queued', 'running');

update public.test_ai_grading_run_items item
set response_revision = response.revision
from public.test_responses response
where response.id = item.response_id
  and item.response_revision is null;
