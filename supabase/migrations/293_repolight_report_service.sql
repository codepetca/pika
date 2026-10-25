-- Report-only foundation. No provider configuration, scheduler or rollout activation.
-- Portable archive/provider cleanup adoption is separately required; destructive
-- source paths remain fenced while any live subject exists, independently of gates.
begin;
create table private.repolight_settings(singleton boolean primary key default true check(singleton),enabled boolean not null default false);
insert into private.repolight_settings(singleton) values(true);
alter table private.repolight_settings enable row level security;
revoke all on private.repolight_settings from public,anon,authenticated,service_role;
create table private.repolight_subject_bindings(
 id uuid primary key default gen_random_uuid(),intent_id uuid not null unique,
 teacher_id uuid references public.users(id) on delete set null,classroom_id uuid references public.classrooms(id),assignment_id uuid references public.assignments(id),student_id uuid references public.users(id),enrollment_id uuid,
 scope_digest text not null check(scope_digest ~ '^[a-f0-9]{64}$'),
 connection_ref text not null,workspace_ref text not null,installation_ref text not null,
 subject_ref text not null unique default ('pika_subject_'||replace(gen_random_uuid()::text,'-','')),
 state text not null default 'active' check(state in('active','erasing','erased')),
 operation_id uuid unique,receipt jsonb,created_at timestamptz not null default clock_timestamp(),erased_at timestamptz,
 check((state='erased')=(receipt is not null and erased_at is not null)),check(state='erased' or teacher_id is not null),
 check(connection_ref ~ '^[A-Za-z0-9._~-]{1,128}$' and workspace_ref ~ '^[A-Za-z0-9._~-]{1,128}$' and installation_ref ~ '^[A-Za-z0-9._~-]{1,128}$')
);
create index repolight_subject_target on private.repolight_subject_bindings(classroom_id,student_id,assignment_id) where state<>'erased';
alter table private.repolight_subject_bindings enable row level security;
revoke all on private.repolight_subject_bindings from public,anon,authenticated,service_role;
create table public.assignment_repolight_runs(
 id uuid primary key,subject_binding_id uuid unique references private.repolight_subject_bindings(id),detached boolean not null default false,
 check ((detached and subject_binding_id is null) or (not detached and subject_binding_id is not null)),
 classroom_id uuid not null references public.classrooms(id) on delete cascade,assignment_id uuid not null references public.assignments(id) on delete cascade,student_id uuid not null references public.users(id),actor_id uuid not null references public.users(id),
 source_json jsonb not null,source_fingerprint text not null,connection_json jsonb not null,request_json jsonb not null,create_envelope jsonb not null,request_fingerprint text not null,idempotency_key text not null unique,
 analysis_id uuid,status text not null default 'queued' check(status in('queued','submitting','running','completed','failed','stale')),
 attempt_count integer not null default 0 check(attempt_count between 0 and 3),poll_failure_count integer not null default 0 check(poll_failure_count between 0 and 3),next_retry_at timestamptz,
 lease_token uuid,lease_generation integer not null default 0,lease_expires_at timestamptz,
 error_code text check(error_code is null or error_code ~ '^[a-z_]{1,64}$'),created_at timestamptz not null default clock_timestamp(),completed_at timestamptz,
 check(source_fingerprint ~ '^[a-f0-9]{64}$' and request_fingerprint ~ '^[a-f0-9]{64}$'),check(octet_length(create_envelope::text)<=65536)
);
create unique index assignment_repolight_active on public.assignment_repolight_runs(assignment_id,student_id) where status in('queued','submitting','running');
create index assignment_repolight_poll on public.assignment_repolight_runs(status,next_retry_at);
create table public.assignment_repolight_reports(
 id uuid not null unique default gen_random_uuid(),run_id uuid primary key references public.assignment_repolight_runs(id) on delete cascade,
 assignment_id uuid not null references public.assignments(id) on delete cascade,student_id uuid not null references public.users(id),
 report_ref uuid not null,report_digest text not null check(report_digest ~ '^[a-f0-9]{64}$'),result_json jsonb not null,created_at timestamptz not null default clock_timestamp(),
 check(octet_length(result_json::text)<=8500000)
);
create table public.assignment_repolight_feedback_imports(
 id uuid primary key,run_id uuid not null references public.assignment_repolight_runs(id) on delete cascade,
 assignment_id uuid not null references public.assignments(id) on delete cascade,student_id uuid not null references public.users(id),actor_id uuid not null references public.users(id),
 scope_key text not null,report_digest text not null,feedback_digest text not null,doc_ack jsonb not null,created_at timestamptz not null default clock_timestamp()
);
alter table public.assignment_repolight_runs enable row level security;
alter table public.assignment_repolight_reports enable row level security;
alter table public.assignment_repolight_feedback_imports enable row level security;
revoke all on public.assignment_repolight_runs,public.assignment_repolight_reports,public.assignment_repolight_feedback_imports from public,anon,authenticated,service_role;
grant select on public.assignment_repolight_runs,public.assignment_repolight_reports,public.assignment_repolight_feedback_imports to service_role;

create function private.repolight_canonical_json_v1(p_value jsonb) returns text language sql immutable set search_path='' as $$
 select case jsonb_typeof(p_value)
 when 'object' then '{'||coalesce((select string_agg(to_jsonb(e.key)::text||':'||private.repolight_canonical_json_v1(e.value),',' order by e.key collate "C") from jsonb_each(p_value)e),'')||'}'
 when 'array' then '['||coalesce((select string_agg(private.repolight_canonical_json_v1(e.value),',' order by e.ordinality) from jsonb_array_elements(p_value) with ordinality e(value,ordinality)),'')||']'
 else p_value::text end
$$;
create function private.repolight_digest_v1(p_value jsonb) returns text language sql immutable set search_path='' as $$select encode(extensions.digest(convert_to(private.repolight_canonical_json_v1(p_value),'UTF8'),'sha256'),'hex')$$;
create function private.repolight_source_v1(p_assignment uuid,p_student uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('classroom',(select jsonb_build_object('teacher_id',c.teacher_id,'archived_at',c.archived_at) from public.classrooms c where c.id=a.classroom_id),'assignment',jsonb_build_object('id',a.id,'classroom_id',a.classroom_id,'due_at',a.due_at,'released_at',a.released_at,'is_draft',a.is_draft,'blueprint_archived_at',a.blueprint_archived_at),
 'enrollment',(select jsonb_build_object('id',e.id,'classroom_id',e.classroom_id,'student_id',e.student_id,'created_at',e.created_at) from public.classroom_enrollments e where e.classroom_id=a.classroom_id and e.student_id=p_student),
 'doc',(select jsonb_build_object('id',d.id,'repo_url',d.repo_url,'github_username',d.github_username) from public.assignment_docs d where d.assignment_id=a.id and d.student_id=p_student),
 'artifacts',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'assignment_doc_id',s.assignment_doc_id,'requirement_id',s.requirement_id,'student_id',s.student_id,'type',s.type,'url',s.url,'metadata_json',jsonb_build_object('normalized_url',s.metadata_json->'normalized_url','github_login',s.metadata_json->'github_login','github_login_selection',s.metadata_json->'github_login_selection')) order by s.id) from public.assignment_submission_artifacts s join public.assignment_docs sd on sd.id=s.assignment_doc_id where sd.assignment_id=a.id and s.student_id=p_student and s.type='repo_link'),'[]'::jsonb),
 'repo_target',(select jsonb_build_object('selected_repo_url',t.selected_repo_url,'selection_mode',t.selection_mode,'override_github_username',t.override_github_username) from public.assignment_repo_targets t where t.assignment_id=a.id and t.student_id=p_student),
 'class_days',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'date',d.date,'is_class_day',d.is_class_day) order by d.date) from public.class_days d where d.classroom_id=a.classroom_id),'[]'::jsonb))
 from public.assignments a where a.id=p_assignment
$$;
create function private.authorize_repolight_target_v1(p_actor uuid,p_assignment uuid,p_student uuid,p_write boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare cid uuid; actual uuid; archived timestamptz; retired timestamptz;
begin
 perform pg_advisory_xact_lock(hashtextextended('assignment_submission:'||p_assignment::text,0));
 select classroom_id into cid from public.assignments where id=p_assignment;
 if cid is null then raise exception using errcode='P0002',message='Assignment not found';end if;
 perform pg_advisory_xact_lock(hashtextextended('pika-classroom-operation:'||cid::text,0));
 perform private.try_lock_classroom_membership_change(cid,p_student);
 select c.teacher_id,c.archived_at,a.blueprint_archived_at into actual,archived,retired from public.assignments a join public.classrooms c on c.id=a.classroom_id where a.id=p_assignment and c.id=cid for update of a,c;
 if actual is distinct from p_actor then raise exception using errcode='42501',message='Forbidden';end if;
 if p_write and (archived is not null or retired is not null) then raise exception using errcode='55000',message='repolight_archived';end if;
 if p_write then
  if exists(select 1 from private.repolight_decommission_intents where assignment_id=p_assignment and kind='assignment_delete' and status='cleanup_pending') then raise exception using errcode='55000',message='repolight_assignment_delete_pending';end if;
  perform 1 from public.classroom_enrollments where classroom_id=cid and student_id=p_student for share;
  if not found then raise exception using errcode='42501',message='Enrollment required';end if;
  if exists(select 1 from public.student_purge_fences where classroom_id=cid and student_id=p_student) then raise exception using errcode='55000',message='student_purge_active';end if;
 end if;
 return cid;
end $$;
create function public.get_assignment_repolight_source_v1(p_actor_id uuid,p_assignment_id uuid,p_student_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare source jsonb;
begin
 perform private.authorize_repolight_target_v1(p_actor_id,p_assignment_id,p_student_id,false);
 source:=private.repolight_source_v1(p_assignment_id,p_student_id);
 return jsonb_build_object('source',source,'source_fingerprint',private.repolight_digest_v1(source),'latest_run',(select to_jsonb(r) from public.assignment_repolight_runs r where r.assignment_id=p_assignment_id and r.student_id=p_student_id order by r.created_at desc,r.id desc limit 1));
end $$;
create function public.begin_assignment_repolight_run_v1(p_actor_id uuid,p_assignment_id uuid,p_student_id uuid,p_request_id uuid,p_connection jsonb,p_request jsonb,p_expected_source jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare cid uuid; source jsonb; r public.assignment_repolight_runs; b private.repolight_subject_bindings; envelope jsonb; fingerprint text;
begin
 cid:=private.authorize_repolight_target_v1(p_actor_id,p_assignment_id,p_student_id,true);
 if not exists(select 1 from private.repolight_settings where singleton and enabled) then raise exception using errcode='55000',message='repolight_disabled';end if;
 source:=private.repolight_source_v1(p_assignment_id,p_student_id);
 if source is distinct from p_expected_source then raise exception using errcode='40001',message='repolight_source_changed';end if;
 if p_request_id is null or jsonb_typeof(p_connection) is distinct from 'object' or not(p_connection ?& array['connectionRef','workspaceRef','installationRef']) or (select count(*) from jsonb_object_keys(p_connection))<>3
 or exists(select 1 from jsonb_each_text(p_connection)e where e.value !~ '^[A-Za-z0-9._~-]{1,128}$')
 or jsonb_typeof(p_request) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_request)k where k<>all(array['repositoryUrl','branch','githubUsername','period','scheduledProjectDates','baselineReviewed','exclusions'])) or not(p_request ?& array['repositoryUrl','period','scheduledProjectDates','baselineReviewed','exclusions']) or octet_length(p_request::text)>64000 or coalesce(p_request->>'repositoryUrl','') !~ '^https://github.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
 then raise exception using errcode='22023',message='Invalid RepoLight request';end if;
 -- Bind repository selection to saved work/teacher override; never use repo owner as username.
 if p_request->>'repositoryUrl' is distinct from regexp_replace(source#>>'{repo_target,selected_repo_url}','[.]git$','') and p_request->>'repositoryUrl' is distinct from regexp_replace(source#>>'{doc,repo_url}','[.]git$','')
 and not exists(select 1 from jsonb_array_elements(source->'artifacts')a where a->>'type'='repo_link' and (regexp_replace(a->>'url','[.]git$','')=p_request->>'repositoryUrl' or regexp_replace(a#>>'{metadata_json,normalized_url}','[.]git$','')=p_request->>'repositoryUrl')) then raise exception using errcode='22023',message='Repository is not submitted';end if;
 select * into r from public.assignment_repolight_runs where id=p_request_id for update;
 if found then
  if r.detached then raise exception using errcode='55000',message='repolight_detached_report';end if;
  if r.assignment_id<>p_assignment_id or r.student_id<>p_student_id or r.actor_id<>p_actor_id or r.request_json<>p_request or r.connection_json<>p_connection or r.source_json<>source then raise exception using errcode='40001',message='repolight_intent_conflict';end if;
  -- Exact replay never creates another subject, including after cleanup closes
  -- this intent. Retire only its operational authority and return that outcome.
  if r.status in('queued','submitting','running') and not exists(select 1 from private.repolight_subject_bindings where id=r.subject_binding_id and state='active') then
   update public.assignment_repolight_runs set status='stale',error_code='repolight_subject_closed',next_retry_at=null,lease_token=null,lease_generation=lease_generation+1,lease_expires_at=null,completed_at=clock_timestamp() where id=r.id returning * into r;
  end if;
  return to_jsonb(r);
 end if;
 if exists(select 1 from private.repolight_subject_bindings where intent_id=p_request_id) then raise exception using errcode='55000',message='repolight_subject_closed';end if;
 -- Only an authorized POST with validated current input may supersede an active
 -- target. Preserve inputs, remote IDs, facts and every uncertain cleanup intent.
 update public.assignment_repolight_runs old_run set status='stale',error_code='repolight_superseded',next_retry_at=null,lease_token=null,lease_generation=old_run.lease_generation+1,lease_expires_at=null,completed_at=clock_timestamp()
 where old_run.assignment_id=p_assignment_id and old_run.student_id=p_student_id and old_run.status in('queued','submitting','running') and
 (old_run.source_json is distinct from source or old_run.request_json is distinct from p_request or old_run.connection_json is distinct from p_connection or not exists(select 1 from private.repolight_subject_bindings where id=old_run.subject_binding_id and state='active'));
 if exists(select 1 from public.assignment_repolight_runs where assignment_id=p_assignment_id and student_id=p_student_id and status in('queued','submitting','running')) then raise exception using errcode='40001',message='repolight_run_active';end if;
 fingerprint:=private.repolight_digest_v1(source);
 insert into private.repolight_subject_bindings(intent_id,teacher_id,classroom_id,assignment_id,student_id,enrollment_id,scope_digest,connection_ref,workspace_ref,installation_ref)
 values(p_request_id,p_actor_id,cid,p_assignment_id,p_student_id,(source#>>'{enrollment,id}')::uuid,private.repolight_digest_v1(jsonb_build_array(cid,p_assignment_id,p_student_id,p_request_id)),p_connection->>'connectionRef',p_connection->>'workspaceRef',p_connection->>'installationRef') returning * into b;
 envelope:=jsonb_build_object('schemaVersion','1.0','request',p_request,'clientBinding',jsonb_build_object('installationRef',b.installation_ref,'subjectRef',b.subject_ref,'sourceRevisionRef',fingerprint));
 insert into public.assignment_repolight_runs(id,subject_binding_id,classroom_id,assignment_id,student_id,actor_id,source_json,source_fingerprint,connection_json,request_json,create_envelope,request_fingerprint,idempotency_key)
 values(p_request_id,b.id,cid,p_assignment_id,p_student_id,p_actor_id,source,fingerprint,p_connection,p_request,envelope,private.repolight_digest_v1(envelope),'pika-'||p_request_id::text) returning * into r;
 return to_jsonb(r);
end $$;
create function public.read_assignment_repolight_run_v1(p_actor_id uuid,p_assignment_id uuid,p_student_id uuid,p_run_id uuid,p_include_report boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.assignment_repolight_runs; result jsonb;
begin
 perform private.authorize_repolight_target_v1(p_actor_id,p_assignment_id,p_student_id,false);
 select * into r from public.assignment_repolight_runs where id=p_run_id and assignment_id=p_assignment_id and student_id=p_student_id;
 if not found then raise exception using errcode='P0002',message='Analysis not found';end if;
 result:=to_jsonb(r)||jsonb_build_object('source_current',not r.detached and r.source_json=private.repolight_source_v1(p_assignment_id,p_student_id));
 if p_include_report then result:=result||jsonb_build_object('report',(select result_json from public.assignment_repolight_reports where run_id=r.id));end if;
 return result;
end $$;
create function public.advance_assignment_repolight_run_v1(p_actor_id uuid,p_assignment_id uuid,p_student_id uuid,p_run_id uuid,p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.assignment_repolight_runs; b private.repolight_subject_bindings; result jsonb; can_retry boolean;
begin
 perform private.authorize_repolight_target_v1(p_actor_id,p_assignment_id,p_student_id,true);
 select * into r from public.assignment_repolight_runs where id=p_run_id and assignment_id=p_assignment_id and student_id=p_student_id for update;
 if not found then raise exception using errcode='P0002',message='Analysis not found';end if;
 if r.actor_id<>p_actor_id then raise exception using errcode='42501',message='Forbidden';end if;
 if r.detached then raise exception using errcode='55000',message='repolight_detached_report';end if;
 if r.status='stale' then raise exception using errcode='40001',message='repolight_lease_lost';end if;
 select * into b from private.repolight_subject_bindings where id=r.subject_binding_id for update;
 if b.state<>'active' then raise exception using errcode='55000',message='repolight_subject_closed';end if;
 if r.source_json is distinct from private.repolight_source_v1(p_assignment_id,p_student_id) then raise exception using errcode='40001',message='repolight_source_changed';end if;
 if r.status in('completed','failed') then
  if p_action is distinct from 'claim' then raise exception using errcode='40001',message='repolight_lease_lost';end if;
  return to_jsonb(r);
 end if;
 if p_action='claim' then
  if r.lease_expires_at>clock_timestamp() or r.next_retry_at>clock_timestamp() then return to_jsonb(r)-'lease_token';end if;
  if (r.analysis_id is null and r.attempt_count>=3) or (r.analysis_id is not null and r.poll_failure_count>=3) or r.created_at<clock_timestamp()-interval '24 hours' then
   update public.assignment_repolight_runs set status='failed',error_code='attempts_exhausted',completed_at=clock_timestamp(),lease_token=null,lease_expires_at=null where id=r.id returning * into r;return to_jsonb(r);
  end if;
  update public.assignment_repolight_runs set status=case when analysis_id is null then 'submitting' else 'running' end,lease_token=gen_random_uuid(),lease_generation=lease_generation+1,lease_expires_at=clock_timestamp()+interval '90 seconds',attempt_count=attempt_count+case when analysis_id is null then 1 else 0 end,next_retry_at=null where id=r.id returning * into r;
  return to_jsonb(r);
 end if;
 if r.lease_token is null or r.lease_token is distinct from (p_payload->>'leaseToken')::uuid or r.lease_generation is distinct from (p_payload->>'leaseGeneration')::integer or r.lease_expires_at<=clock_timestamp() then raise exception using errcode='40001',message='repolight_lease_lost';end if;
 if p_action='authorize' then return to_jsonb(r);end if;
 if p_action='poll_pending' then
  update public.assignment_repolight_runs set status='running',lease_token=null,lease_expires_at=null,next_retry_at=clock_timestamp()+interval '5 seconds' where id=r.id returning * into r;
 elsif p_action='record_remote' then
  if r.analysis_id is not null and r.analysis_id is distinct from (p_payload->>'analysisId')::uuid then raise exception using errcode='40001',message='repolight_remote_conflict';end if;
  update public.assignment_repolight_runs set analysis_id=(p_payload->>'analysisId')::uuid,status='running' where id=r.id returning * into r;
 elsif p_action='complete' then
  result:=p_payload->'result';
  if r.analysis_id is null or result->>'schemaVersion' is distinct from '1.0' or result->>'analysisId' is distinct from r.analysis_id::text or result->>'reportRef' is distinct from r.analysis_id::text or result#>>'{bundle,bundleRef}' is distinct from r.analysis_id::text or result->>'requestFingerprint' is distinct from r.request_fingerprint or result->'clientBinding' is distinct from r.create_envelope->'clientBinding' or result->>'reportDigest' is distinct from private.repolight_digest_v1(result->'bundle') then raise exception using errcode='22023',message='repolight_result_binding_invalid';end if;
  insert into public.assignment_repolight_reports(run_id,assignment_id,student_id,report_ref,report_digest,result_json) values(r.id,r.assignment_id,r.student_id,r.analysis_id,result->>'reportDigest',result);
  update public.assignment_repolight_runs set status='completed',completed_at=clock_timestamp(),lease_token=null,lease_expires_at=null,error_code=null where id=r.id returning * into r;
 elsif p_action='retry' then
  if p_payload->>'errorCode' !~ '^[a-z_]{1,64}$' then raise exception using errcode='22023',message='Invalid safe error';end if;
  can_retry:=coalesce((p_payload->>'retryable')::boolean,false) and case when r.analysis_id is null then r.attempt_count<3 else r.poll_failure_count+1<3 end;
  if r.analysis_id is not null then update public.assignment_repolight_runs set poll_failure_count=least(3,poll_failure_count+1) where id=r.id;end if;
  update public.assignment_repolight_runs set status=case when can_retry then 'queued' else 'failed' end,error_code=p_payload->>'errorCode',next_retry_at=case when can_retry then clock_timestamp()+interval '15 seconds' else null end,completed_at=case when can_retry then null else clock_timestamp() end,lease_token=null,lease_expires_at=null where id=r.id returning * into r;
 else raise exception using errcode='22023',message='Invalid RepoLight transition';end if;
 return to_jsonb(r);
end $$;
create function public.import_assignment_repolight_feedback_v1(p_actor_id uuid,p_assignment_id uuid,p_student_id uuid,p_run_id uuid,p_request_id uuid,p_scope_key text,p_expected_doc_updated_at timestamptz,p_expected_report_digest text,p_feedback_text text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.assignment_repolight_runs; report public.assignment_repolight_reports; prior public.assignment_repolight_feedback_imports; d public.assignment_docs; v_feedback text; ack jsonb;
begin
 perform private.authorize_repolight_target_v1(p_actor_id,p_assignment_id,p_student_id,true);
 select * into r from public.assignment_repolight_runs where id=p_run_id and assignment_id=p_assignment_id and student_id=p_student_id for update;
 if not found then raise exception using errcode='P0002',message='Analysis not found';end if;
 if r.detached then raise exception using errcode='55000',message='repolight_detached_report';end if;
 select * into prior from public.assignment_repolight_feedback_imports where id=p_request_id;
 if found then
  if prior.run_id<>r.id or prior.actor_id<>p_actor_id or prior.scope_key<>p_scope_key or prior.report_digest<>p_expected_report_digest then raise exception using errcode='40001',message='repolight_import_conflict';end if;
  return jsonb_build_object('doc',prior.doc_ack,'imported',true,'replayed',true);
 end if;
 if r.detached or r.status<>'completed' or r.source_json is distinct from private.repolight_source_v1(p_assignment_id,p_student_id) or not exists(select 1 from private.repolight_subject_bindings where id=r.subject_binding_id and state='active') then raise exception using errcode='40001',message='repolight_source_changed';end if;
 select * into report from public.assignment_repolight_reports where run_id=r.id;
 if report.report_digest is distinct from p_expected_report_digest then raise exception using errcode='40001',message='repolight_report_changed';end if;
 if p_scope_key='repository' then v_feedback:=report.result_json#>>'{bundle,overview,ruleFeedback,feedbackDraft}';
 else select entry#>>'{analysis,ruleFeedback,feedbackDraft}' into v_feedback from jsonb_array_elements(report.result_json#>'{bundle,contributors}')entry where 'contributor:'||(entry#>>'{contributor,id}')=p_scope_key;end if;
 if v_feedback is null then raise exception using errcode='22023',message='Unknown report scope';end if;
 v_feedback:=coalesce(p_feedback_text,v_feedback);
 if length(btrim(v_feedback))=0 or length(v_feedback)>20000 then raise exception using errcode='22023',message='Invalid feedback';end if;
 select * into d from public.assignment_docs where assignment_id=p_assignment_id and student_id=p_student_id for update;
 if not found or d.updated_at is distinct from p_expected_doc_updated_at then raise exception using errcode='40001',message='Assignment grade changed';end if;
 if d.returned_at is not null or d.feedback_returned_at is not null then raise exception using errcode='55000',message='repolight_returned_work';end if;
 update public.assignment_docs set teacher_feedback_draft=case when btrim(coalesce(teacher_feedback_draft,''))='' then v_feedback else teacher_feedback_draft||E'\n\n'||v_feedback end,teacher_feedback_draft_updated_at=clock_timestamp(),updated_at=clock_timestamp() where id=d.id returning * into d;
 ack:=jsonb_build_object('id',d.id,'assignment_id',d.assignment_id,'student_id',d.student_id,'updated_at',d.updated_at,'teacher_feedback_draft',d.teacher_feedback_draft,'teacher_feedback_draft_updated_at',d.teacher_feedback_draft_updated_at);
 insert into public.assignment_repolight_feedback_imports(id,run_id,assignment_id,student_id,actor_id,scope_key,report_digest,feedback_digest,doc_ack) values(p_request_id,r.id,p_assignment_id,p_student_id,p_actor_id,p_scope_key,report.report_digest,private.repolight_digest_v1(to_jsonb(v_feedback)),ack);
 return jsonb_build_object('doc',ack,'imported',true,'replayed',false);
end $$;
create function public.begin_repolight_subject_erasure_v1(p_actor_id uuid,p_binding_id uuid,p_operation_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare b private.repolight_subject_bindings;
begin
 select * into b from private.repolight_subject_bindings where id=p_binding_id;
 if not found or b.teacher_id is distinct from p_actor_id then raise exception using errcode='42501',message='Forbidden';end if;
 if b.state='erased' then if b.operation_id=p_operation_id then return to_jsonb(b);end if;raise exception using errcode='40001',message='repolight_erasure_conflict';end if;
 if not exists(select 1 from public.classrooms where id=b.classroom_id and teacher_id=p_actor_id) then raise exception using errcode='42501',message='Forbidden';end if;
 perform pg_advisory_xact_lock(hashtextextended('assignment_submission:'||b.assignment_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('pika-classroom-operation:'||b.classroom_id::text,0));
 perform private.try_lock_classroom_membership_change(b.classroom_id,b.student_id);
 select * into b from private.repolight_subject_bindings where id=p_binding_id for update;
 if p_operation_id is null or (b.operation_id is not null and b.operation_id<>p_operation_id) then raise exception using errcode='40001',message='repolight_erasure_conflict';end if;
 update private.repolight_subject_bindings set state=case when state='erased' then state else 'erasing' end,operation_id=p_operation_id where id=b.id returning * into b;
 return to_jsonb(b);
end $$;
create function public.record_repolight_subject_erasure_v1(p_actor_id uuid,p_binding_id uuid,p_operation_id uuid,p_receipt jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare b private.repolight_subject_bindings;
begin
 select * into b from private.repolight_subject_bindings where id=p_binding_id;
 if not found or b.teacher_id is distinct from p_actor_id then raise exception using errcode='42501',message='Forbidden';end if;
 if b.state='erased' then
  if b.operation_id=p_operation_id and b.receipt=p_receipt then return to_jsonb(b);end if;
  raise exception using errcode='40001',message='repolight_erasure_conflict';
 end if;
 perform public.begin_repolight_subject_erasure_v1(p_actor_id,p_binding_id,p_operation_id);
 select * into b from private.repolight_subject_bindings where id=p_binding_id for update;
 if p_receipt is distinct from jsonb_build_object('schemaVersion','1.0','operationRef',p_operation_id,'installationRef',b.installation_ref,'subjectRef',b.subject_ref,'status','erased','absenceVerified',true) then raise exception using errcode='22023',message='repolight_erasure_receipt_invalid';end if;
 update private.repolight_subject_bindings set state='erased',receipt=p_receipt,erased_at=clock_timestamp(),classroom_id=null,assignment_id=null,student_id=null,enrollment_id=null where id=b.id;
 perform private.complete_repolight_removed_intent_v1(s.operation_id) from private.repolight_purge_subjects s where s.binding_id=b.id;
 -- Retain immutable local facts; authorized classroom/student lifecycle owns local deletion.
 select * into b from private.repolight_subject_bindings where id=b.id;
 return to_jsonb(b);
end $$;

-- Independent lifecycle fences: they apply even when new-work settings are off.
create function private.repolight_source_guard_v1() returns trigger language plpgsql security definer set search_path='' as $$
declare cid uuid; aid uuid; sid uuid; blocked boolean;
begin
 if tg_table_name='classrooms' then
  cid:=old.id;
  if tg_op='UPDATE' and new.teacher_id is not distinct from old.teacher_id then return new;end if;
 elsif tg_table_name='assignments' then
  cid:=old.classroom_id;aid:=old.id;
  if tg_op='UPDATE' and new.classroom_id is not distinct from old.classroom_id then return new;end if;
 elsif tg_table_name='assignment_docs' then
  aid:=old.assignment_id;sid:=old.student_id;
 elsif tg_table_name='users' then
  sid:=old.id;
 end if;
 select exists(select 1 from private.repolight_subject_bindings b where b.state<>'erased' and (cid is null or b.classroom_id=cid) and (aid is null or b.assignment_id=aid) and (sid is null or b.student_id=sid or b.teacher_id=sid)) into blocked;
 if blocked then raise exception using errcode='55000',message='repolight_erasure_required';end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger repolight_classroom_source_guard before delete or update of teacher_id on public.classrooms for each row execute function private.repolight_source_guard_v1();
create trigger repolight_assignment_source_guard before delete or update of classroom_id on public.assignments for each row execute function private.repolight_source_guard_v1();
create trigger repolight_document_delete_guard before delete on public.assignment_docs for each row execute function private.repolight_source_guard_v1();
create trigger repolight_account_delete_guard before delete on public.users for each row execute function private.repolight_source_guard_v1();
create function private.repolight_membership_guard_v1() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('pika-classroom-operation:'||(case when tg_op='DELETE' then old.classroom_id else new.classroom_id end)::text,0));
 if tg_op='DELETE' then
  update private.repolight_subject_bindings set state='erasing',operation_id=coalesce(operation_id,gen_random_uuid()) where classroom_id=old.classroom_id and student_id=old.student_id and state='active';
  return old;
 end if;
 if exists(select 1 from private.repolight_subject_bindings where classroom_id=new.classroom_id and student_id=new.student_id and state='erasing') then raise exception using errcode='55000',message='repolight_erasure_required';end if;
 return new;
end $$;
create trigger repolight_membership_guard before insert or delete on public.classroom_enrollments for each row execute function private.repolight_membership_guard_v1();
create function private.repolight_record_guard_v1() returns trigger language plpgsql security definer set search_path='' as $$
declare binding uuid;
begin
 if tg_table_name='assignment_repolight_runs' then
  if tg_op='UPDATE' and (to_jsonb(new)-array['analysis_id','status','attempt_count','poll_failure_count','next_retry_at','lease_token','lease_generation','lease_expires_at','error_code','completed_at']) is distinct from (to_jsonb(old)-array['analysis_id','status','attempt_count','poll_failure_count','next_retry_at','lease_token','lease_generation','lease_expires_at','error_code','completed_at']) then raise exception using errcode='55000',message='repolight_input_immutable';end if;
  binding:=old.subject_binding_id;
 else
  if tg_op='UPDATE' then raise exception using errcode='55000',message='repolight_report_immutable';end if;
  select subject_binding_id into binding from public.assignment_repolight_runs where id=old.run_id;
 end if;
 if tg_op='DELETE' and exists(select 1 from private.repolight_subject_bindings where id=binding and state<>'erased') then raise exception using errcode='55000',message='repolight_erasure_required';end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger repolight_run_record_guard before update or delete on public.assignment_repolight_runs for each row execute function private.repolight_record_guard_v1();
create trigger repolight_report_record_guard before update or delete on public.assignment_repolight_reports for each row execute function private.repolight_record_guard_v1();
create trigger repolight_import_record_guard before update or delete on public.assignment_repolight_feedback_imports for each row execute function private.repolight_record_guard_v1();

-- Prevent cold compaction before any source/file work; portable adoption is pending.
create function private.repolight_archive_guard_v1() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.operation_type='compact' and exists(select 1 from private.repolight_subject_bindings where classroom_id=new.classroom_id and state<>'erased') then raise exception using errcode='55000',message='repolight_erasure_required';end if;
 return new;
end $$;
create trigger repolight_compaction_guard before insert or update of operation_type on public.classroom_archive_operations for each row execute function private.repolight_archive_guard_v1();
create function private.repolight_binding_guard_v1() returns trigger language plpgsql security definer set search_path='' as $$
begin
 -- Only the users FK's terminal SET NULL may redact the remaining owner after account deletion.
 if tg_op='UPDATE' and old.state='erased' and old.teacher_id is not null and new.teacher_id is null and (to_jsonb(new)-'teacher_id')=(to_jsonb(old)-'teacher_id') and not exists(select 1 from public.users where id=old.teacher_id) then return new;end if;
 if tg_op='DELETE' or (to_jsonb(new)-array['classroom_id','assignment_id','student_id','enrollment_id','state','operation_id','receipt','erased_at']) is distinct from (to_jsonb(old)-array['classroom_id','assignment_id','student_id','enrollment_id','state','operation_id','receipt','erased_at'])
 or (old.operation_id is not null and new.operation_id is distinct from old.operation_id)
 or (old.state='erased' and new is distinct from old)
 or ((new.classroom_id is distinct from old.classroom_id or new.assignment_id is distinct from old.assignment_id or new.student_id is distinct from old.student_id or new.enrollment_id is distinct from old.enrollment_id) and not(new.state='erased' and new.classroom_id is null and new.assignment_id is null and new.student_id is null and new.enrollment_id is null))
 then raise exception using errcode='55000',message='repolight_binding_immutable';end if;
 return new;
end $$;
create trigger repolight_binding_immutable before update or delete on private.repolight_subject_bindings for each row execute function private.repolight_binding_guard_v1();

-- Wrappers preserve all existing checks, adding pre-deletion remote-copy denial.
alter function public.classroom_purge_conflict(uuid) rename to classroom_purge_conflict_before_repolight_293;
create function public.classroom_purge_conflict(p_classroom_id uuid) returns text language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.repolight_subject_bindings where classroom_id=p_classroom_id and state<>'erased') then return 'repolight_erasure_required';end if;
 return public.classroom_purge_conflict_before_repolight_293(p_classroom_id);
end $$;
alter function public.student_purge_conflict(uuid,uuid) rename to student_purge_conflict_before_repolight_293;
create function public.student_purge_conflict(p_classroom_id uuid,p_student_id uuid) returns text language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.repolight_subject_bindings where classroom_id=p_classroom_id and student_id=p_student_id and state<>'erased') then return 'repolight_erasure_required';end if;
 return public.student_purge_conflict_before_repolight_293(p_classroom_id,p_student_id);
end $$;
alter function private.removed_academic_blockers(uuid) rename to removed_academic_blockers_before_repolight_293;
create function private.removed_academic_blockers(p_operation_id uuid) returns text[] language plpgsql security definer set search_path='' as $$
declare result text[];
begin
 result:=private.removed_academic_blockers_before_repolight_293(p_operation_id);
 if exists(select 1 from public.student_purge_operations op join private.repolight_subject_bindings b on b.classroom_id=op.classroom_id and b.student_id=op.student_id where op.id=p_operation_id and b.state<>'erased') then result:=array_append(result,'repolight_erasure_required');end if;
 return result;
end $$;
-- New report records are provider-bound while portable adoption is pending.
-- A schema-audit classification below names every relationship explicitly.
revoke all on function private.repolight_canonical_json_v1(jsonb),private.repolight_digest_v1(jsonb),private.repolight_source_v1(uuid,uuid),private.authorize_repolight_target_v1(uuid,uuid,uuid,boolean),private.repolight_source_guard_v1(),private.repolight_membership_guard_v1(),private.repolight_record_guard_v1(),private.repolight_archive_guard_v1(),private.repolight_binding_guard_v1(),private.removed_academic_blockers_before_repolight_293(uuid),private.removed_academic_blockers(uuid) from public,anon,authenticated,service_role;
revoke all on function public.classroom_purge_conflict_before_repolight_293(uuid),public.student_purge_conflict_before_repolight_293(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_assignment_repolight_source_v1(uuid,uuid,uuid),public.begin_assignment_repolight_run_v1(uuid,uuid,uuid,uuid,jsonb,jsonb,jsonb),public.read_assignment_repolight_run_v1(uuid,uuid,uuid,uuid,boolean),public.advance_assignment_repolight_run_v1(uuid,uuid,uuid,uuid,text,jsonb),public.import_assignment_repolight_feedback_v1(uuid,uuid,uuid,uuid,uuid,text,timestamptz,text,text),public.begin_repolight_subject_erasure_v1(uuid,uuid,uuid),public.record_repolight_subject_erasure_v1(uuid,uuid,uuid,jsonb),public.classroom_purge_conflict(uuid),public.student_purge_conflict(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_assignment_repolight_source_v1(uuid,uuid,uuid),public.begin_assignment_repolight_run_v1(uuid,uuid,uuid,uuid,jsonb,jsonb,jsonb),public.read_assignment_repolight_run_v1(uuid,uuid,uuid,uuid,boolean),public.advance_assignment_repolight_run_v1(uuid,uuid,uuid,uuid,text,jsonb),public.import_assignment_repolight_feedback_v1(uuid,uuid,uuid,uuid,uuid,text,timestamptz,text,text),public.begin_repolight_subject_erasure_v1(uuid,uuid,uuid),public.record_repolight_subject_erasure_v1(uuid,uuid,uuid,jsonb),public.classroom_purge_conflict(uuid),public.student_purge_conflict(uuid,uuid) to service_role;

-- Additive portable family. Historical V1 rows/registry are never changed.
insert into public.classroom_archive_resource_contract_versions(format_version,table_name,primary_key_columns,parent_table,parent_column,actor_columns,restore_after,export_position)
select 2,v.table_name,v.pk,v.parent,v.column_name,v.actors,v.dependencies,m.position+v.ordinal
from (values
 ('assignment_repolight_runs',array['id'],'assignments','assignment_id',array['actor_id','student_id'],array['assignments','classrooms'],1),
 ('assignment_repolight_reports',array['run_id'],'assignment_repolight_runs','run_id',array['student_id'],array['assignment_repolight_runs','assignments'],2),
 ('assignment_repolight_feedback_imports',array['id'],'assignment_repolight_runs','run_id',array['actor_id','student_id'],array['assignment_repolight_runs','assignments'],3)
) v(table_name,pk,parent,column_name,actors,dependencies,ordinal)
cross join(select max(export_position) position from public.classroom_archive_resource_contract_versions where format_version=2)m;
insert into public.classroom_archive_resource_contract(table_name,primary_key_columns,parent_table,parent_column,actor_columns,restore_after,export_position)
select table_name,primary_key_columns,parent_table,parent_column,actor_columns,restore_after,export_position from public.classroom_archive_resource_contract_versions where format_version=2 and table_name in('assignment_repolight_runs','assignment_repolight_reports','assignment_repolight_feedback_imports');
create trigger car_repolight_runs before insert or update or delete on public.assignment_repolight_runs for each row execute function public.bump_classroom_archive_revision_from_resource('assignments','assignment_id');
create trigger car_repolight_reports before insert or update or delete on public.assignment_repolight_reports for each row execute function public.bump_classroom_archive_revision_from_resource('assignments','assignment_id');
create trigger car_repolight_imports before insert or update or delete on public.assignment_repolight_feedback_imports for each row execute function public.bump_classroom_archive_revision_from_resource('assignments','assignment_id');
create trigger cpp_repolight_runs before insert or update or delete on public.assignment_repolight_runs for each row execute function public.reject_classroom_resource_change_during_purge('assignments','assignment_id');
create trigger cpp_repolight_reports before insert or update or delete on public.assignment_repolight_reports for each row execute function public.reject_classroom_resource_change_during_purge('assignments','assignment_id');
create trigger cpp_repolight_imports before insert or update or delete on public.assignment_repolight_feedback_imports for each row execute function public.reject_classroom_resource_change_during_purge('assignments','assignment_id');

-- The existing exact student/removed inventory and finalizer already delete by
-- UUID id in FK-safe table-name order; reports keep run_id as their real PK and
-- add a separate ordinary id for this product-owned erasure inventory.
alter function public.student_purge_inventory_resources(uuid,uuid) rename to student_purge_inventory_before_repolight_293;
create function public.student_purge_inventory_resources(p_classroom_id uuid,p_student_id uuid) returns table(table_name text,row_id uuid,disposition text) language sql stable security definer set search_path='' as $$
 select * from public.student_purge_inventory_before_repolight_293(p_classroom_id,p_student_id)
 union all select 'assignment_repolight_runs',r.id,'delete' from public.assignment_repolight_runs r where r.classroom_id=p_classroom_id and r.student_id=p_student_id
 union all select 'assignment_repolight_reports',p.id,'delete' from public.assignment_repolight_reports p join public.assignment_repolight_runs r on r.id=p.run_id where r.classroom_id=p_classroom_id and p.student_id=p_student_id
 union all select 'assignment_repolight_feedback_imports',p.id,'delete' from public.assignment_repolight_feedback_imports p join public.assignment_repolight_runs r on r.id=p.run_id where r.classroom_id=p_classroom_id and p.student_id=p_student_id
$$;
alter function private.removed_academic_row_hash(text,uuid) rename to removed_academic_row_hash_before_repolight_293;
create function private.removed_academic_row_hash(p_table text,p_id uuid) returns text language plpgsql stable security definer set search_path='' as $$
declare value jsonb;
begin
 if p_table='assignment_repolight_runs' then select to_jsonb(r) into value from public.assignment_repolight_runs r where id=p_id;
 elsif p_table='assignment_repolight_reports' then select to_jsonb(r) into value from public.assignment_repolight_reports r where id=p_id;
 elsif p_table='assignment_repolight_feedback_imports' then select to_jsonb(r) into value from public.assignment_repolight_feedback_imports r where id=p_id;
 else return private.removed_academic_row_hash_before_repolight_293(p_table,p_id);end if;
 if value is null then raise exception using errcode='40001',message='academic_cleanup_inventory_drift';end if;
 return encode(extensions.digest(value::text,'sha256'),'hex');
end $$;
create function private.repolight_student_fence_v1() returns trigger language plpgsql security definer set search_path='' as $$
declare cid uuid; sid uuid; aid uuid;
begin
 if tg_op='DELETE' and private.removed_academic_delete_allowed(tg_table_name,to_jsonb(old)) then return old;end if;
 if current_setting('pika.student_purge_finalize',true)='on' then return case when tg_op='DELETE' then old else new end;end if;
 aid:=(case when tg_op='DELETE' then old.assignment_id else new.assignment_id end);sid:=(case when tg_op='DELETE' then old.student_id else new.student_id end);
 select classroom_id into cid from public.assignments where id=aid;
 if exists(select 1 from public.student_purge_fences where classroom_id=cid and student_id=sid) then raise exception using errcode='55000',message='student_purge_active';end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger spp_repolight_runs before insert or update or delete on public.assignment_repolight_runs for each row execute function private.repolight_student_fence_v1();
create trigger spp_repolight_reports before insert or update or delete on public.assignment_repolight_reports for each row execute function private.repolight_student_fence_v1();
create trigger spp_repolight_imports before insert or update or delete on public.assignment_repolight_feedback_imports for each row execute function private.repolight_student_fence_v1();

-- Enumerate saved intents rather than remote job IDs: lost initial POSTs remain
-- discoverable. Read authorization works for retained removed memberships.
create function public.read_repolight_cleanup_subjects_v1(p_actor_id uuid,p_classroom_id uuid default null,p_student_id uuid default null,p_assignment_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare value jsonb;
begin
 if p_actor_id is null or (p_classroom_id is not null and not exists(select 1 from public.classrooms where id=p_classroom_id and teacher_id=p_actor_id)) then raise exception using errcode='42501',message='Forbidden';end if;
 select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at,q.id),'[]'::jsonb) into value from (select b.* from private.repolight_subject_bindings b join public.classrooms c on c.id=b.classroom_id
 where b.teacher_id=p_actor_id and c.teacher_id=p_actor_id and b.state<>'erased' and (p_classroom_id is null or b.classroom_id=p_classroom_id) and (p_student_id is null or b.student_id=p_student_id) and (p_assignment_id is null or b.assignment_id=p_assignment_id) order by b.created_at,b.id limit 100)q;
 return value;
end $$;
revoke all on function public.student_purge_inventory_before_repolight_293(uuid,uuid),private.removed_academic_row_hash_before_repolight_293(text,uuid),private.removed_academic_row_hash(text,uuid),private.repolight_student_fence_v1() from public,anon,authenticated,service_role;
revoke all on function public.student_purge_inventory_resources(uuid,uuid),public.read_repolight_cleanup_subjects_v1(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.student_purge_inventory_resources(uuid,uuid),public.read_repolight_cleanup_subjects_v1(uuid,uuid,uuid,uuid) to service_role;

create or replace function private.removed_academic_resources(p_classroom_id uuid,p_student_id uuid)
returns table(table_name text,row_id uuid,disposition text)
language sql stable set search_path = '' as $$
  select * from public.student_purge_inventory_resources(p_classroom_id,p_student_id)
    where table_name not in ('classroom_roster','classroom_enrollments')
  union all select 'retained_manual_attendance_marks',roster.id,'redact'
    from public.classroom_roster roster where roster.classroom_id=p_classroom_id
      and roster.removed_student_id=p_student_id and roster.removed_at is not null
      and roster.retained_manual_attendance_marks <> '{}'::jsonb
  union all select 'attendance_check_in_facts',id,'delete' from public.attendance_check_in_facts
    where classroom_id=p_classroom_id and student_id=p_student_id
  union all select 'attendance_record_projection',id,'delete' from public.attendance_record_projection
    where classroom_id=p_classroom_id and student_id=p_student_id
  union all select 'attendance_status_overrides',id,'delete' from public.attendance_status_overrides
    where classroom_id=p_classroom_id and student_id=p_student_id
  union all select 'attendance_status_override_events',id,'delete' from public.attendance_status_override_events
    where classroom_id=p_classroom_id and student_id=p_student_id
  union all select 'managed_storage_json_references',reference.id,'delete'
    from public.managed_storage_json_references reference
    left join public.assignment_doc_history history on history.id=reference.assignment_doc_history_id
    join public.assignment_docs doc on doc.id=coalesce(reference.assignment_doc_id,history.assignment_doc_id)
    join public.assignments assignment on assignment.id=doc.assignment_id
    where assignment.classroom_id=p_classroom_id and doc.student_id=p_student_id;
$$;



create function private.repolight_parent_guard_v1() returns trigger language plpgsql security definer set search_path='' as $$
declare parent_assignment uuid; parent_student uuid; parent_classroom uuid;
begin
 if tg_table_name='assignment_repolight_runs' then
  select classroom_id into parent_classroom from public.assignments where id=new.assignment_id;
  if parent_classroom is distinct from new.classroom_id then raise exception using errcode='23514',message='repolight_parent_binding_invalid';end if;
 else
  select assignment_id,student_id into parent_assignment,parent_student from public.assignment_repolight_runs where id=new.run_id;
  if parent_assignment is distinct from new.assignment_id or parent_student is distinct from new.student_id then raise exception using errcode='23514',message='repolight_parent_binding_invalid';end if;
 end if;
 return new;
end $$;
create trigger repolight_run_parent before insert or update on public.assignment_repolight_runs for each row execute function private.repolight_parent_guard_v1();
create trigger repolight_report_parent before insert or update on public.assignment_repolight_reports for each row execute function private.repolight_parent_guard_v1();
create trigger repolight_import_parent before insert or update on public.assignment_repolight_feedback_imports for each row execute function private.repolight_parent_guard_v1();
revoke all on function private.repolight_parent_guard_v1() from public,anon,authenticated,service_role;
-- Confirmed purge admission is distinct from remote erasure and local deletion.
-- The private capability exists only while the original admission chain runs in
-- this transaction. It suppresses this integration's conflict, never older ones.
create table private.repolight_purge_admissions(
 transaction_id bigint primary key,kind text not null check(kind in('student','hot_classroom')),
 classroom_id uuid not null,student_id uuid,check((kind='student')=(student_id is not null))
);
create table private.repolight_purge_reservations(
 operation_id uuid primary key,kind text not null check(kind in('student','hot_classroom')),
 request_fingerprint text not null check(request_fingerprint ~ '^[a-f0-9]{64}$'),created_at timestamptz not null default clock_timestamp()
);
create table private.repolight_purge_subjects(
 operation_id uuid not null references private.repolight_purge_reservations(operation_id),
 binding_id uuid not null references private.repolight_subject_bindings(id),
 erasure_operation_id uuid not null,connection_ref text not null,workspace_ref text not null,
 installation_ref text not null,subject_ref text not null,primary key(operation_id,binding_id)
);
alter table private.repolight_purge_admissions enable row level security;
alter table private.repolight_purge_reservations enable row level security;
alter table private.repolight_purge_subjects enable row level security;
revoke all on private.repolight_purge_admissions,private.repolight_purge_reservations,private.repolight_purge_subjects from public,anon,authenticated,service_role;
create function private.repolight_purge_snapshot_immutable_v1() returns trigger language plpgsql set search_path='' as $$
begin raise exception using errcode='55000',message='repolight_purge_snapshot_immutable';end $$;
create trigger repolight_purge_reservation_immutable before update or delete on private.repolight_purge_reservations for each row execute function private.repolight_purge_snapshot_immutable_v1();
create trigger repolight_purge_subject_immutable before update or delete on private.repolight_purge_subjects for each row execute function private.repolight_purge_snapshot_immutable_v1();

create or replace function public.classroom_purge_conflict(p_classroom_id uuid) returns text language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.repolight_decommission_intents where classroom_id=p_classroom_id and kind='assignment_delete' and status='cleanup_pending') then return 'repolight_assignment_delete_pending';end if;
 if not exists(select 1 from private.repolight_purge_admissions where transaction_id=txid_current() and classroom_id=p_classroom_id)
 and exists(select 1 from private.repolight_subject_bindings where classroom_id=p_classroom_id and state<>'erased') then return 'repolight_erasure_required';end if;
 return public.classroom_purge_conflict_before_repolight_293(p_classroom_id);
end $$;
create or replace function public.student_purge_conflict(p_classroom_id uuid,p_student_id uuid) returns text language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from private.repolight_purge_admissions where transaction_id=txid_current() and kind='student' and classroom_id=p_classroom_id and student_id=p_student_id)
 and exists(select 1 from private.repolight_subject_bindings where classroom_id=p_classroom_id and student_id=p_student_id and state<>'erased') then return 'repolight_erasure_required';end if;
 return public.student_purge_conflict_before_repolight_293(p_classroom_id,p_student_id);
end $$;
create function private.capture_repolight_purge_subjects_v1(p_operation_id uuid,p_kind text,p_fingerprint text,p_classroom_id uuid,p_student_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 insert into private.repolight_purge_reservations(operation_id,kind,request_fingerprint) values(p_operation_id,p_kind,p_fingerprint);
 update private.repolight_subject_bindings set state='erasing',operation_id=coalesce(operation_id,gen_random_uuid())
 where classroom_id=p_classroom_id and (p_student_id is null or student_id=p_student_id) and state<>'erased';
 insert into private.repolight_purge_subjects(operation_id,binding_id,erasure_operation_id,connection_ref,workspace_ref,installation_ref,subject_ref)
 select p_operation_id,id,operation_id,connection_ref,workspace_ref,installation_ref,subject_ref from private.repolight_subject_bindings
 where classroom_id=p_classroom_id and (p_student_id is null or student_id=p_student_id) and state<>'erased';
end $$;

alter function public.begin_student_purge(uuid,uuid,uuid,uuid,text,bigint,text,text) rename to begin_student_purge_before_repolight_293;
create function public.begin_student_purge(p_operation_id uuid,p_teacher_id uuid,p_classroom_id uuid,p_student_id uuid,p_confirmation text,p_expected_source_revision bigint,p_expected_storage_inventory_sha256 text,p_expected_relational_inventory_sha256 text) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; fingerprint text; reservation private.repolight_purge_reservations;
begin
 perform public.student_purge_lock(p_classroom_id,p_student_id);
 fingerprint:=private.repolight_digest_v1(jsonb_build_array(p_teacher_id,p_classroom_id,p_student_id,p_confirmation,p_expected_source_revision,p_expected_storage_inventory_sha256,p_expected_relational_inventory_sha256));
 select * into reservation from private.repolight_purge_reservations where operation_id=p_operation_id;
 if found and (reservation.kind<>'student' or reservation.request_fingerprint<>fingerprint) then return jsonb_build_object('ok',false,'status',409,'error_code','idempotency_conflict','error','Deletion request does not match its reservation');end if;
 begin
  insert into private.repolight_purge_admissions values(txid_current(),'student',p_classroom_id,p_student_id);
  result:=public.begin_student_purge_before_repolight_293(p_operation_id,p_teacher_id,p_classroom_id,p_student_id,p_confirmation,p_expected_source_revision,p_expected_storage_inventory_sha256,p_expected_relational_inventory_sha256);
  if not coalesce((result->>'ok')::boolean,false) then raise exception using errcode='P2930',message='repolight_admission_rejected';end if;
  delete from private.repolight_purge_admissions where transaction_id=txid_current();
  if reservation.operation_id is null and not coalesce((result->>'replayed')::boolean,false) then perform private.capture_repolight_purge_subjects_v1(p_operation_id,'student',fingerprint,p_classroom_id,p_student_id);end if;
 exception when sqlstate 'P2930' then return result;
 end;
 return result;
end $$;

-- Unlike the historical raw hot admission, this RPC validates typed confirmation
-- in SQL before granting the short-lived integration-only exemption.
create function public.reserve_repolight_hot_classroom_purge_v1(p_operation_id uuid,p_teacher_id uuid,p_classroom_id uuid,p_confirmation text,p_expected_source_revision bigint,p_expected_storage_inventory_sha256 text,p_expected_operational_inventory_sha256 text) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; impact jsonb; fingerprint text; request_sha text; title text; reservation private.repolight_purge_reservations;
begin
 perform public.classroom_purge_lock(p_classroom_id);
 select c.title into title from public.classrooms c where c.id=p_classroom_id and c.teacher_id=p_teacher_id for update;
 if not found then return jsonb_build_object('ok',false,'status',404,'error_code','classroom_not_found','error','Classroom not found');end if;
 if p_confirmation is distinct from 'DELETE' and p_confirmation is distinct from title then return jsonb_build_object('ok',false,'status',400,'error_code','confirmation_mismatch','error','Type the classroom name exactly, or type DELETE');end if;
 fingerprint:=private.repolight_digest_v1(jsonb_build_array(p_teacher_id,p_classroom_id,p_confirmation,p_expected_source_revision,p_expected_storage_inventory_sha256,p_expected_operational_inventory_sha256));
 select * into reservation from private.repolight_purge_reservations where operation_id=p_operation_id;
 if found and (reservation.kind<>'hot_classroom' or reservation.request_fingerprint<>fingerprint) then return jsonb_build_object('ok',false,'status',409,'error_code','idempotency_conflict','error','Deletion request does not match its reservation');end if;
 begin
  insert into private.repolight_purge_admissions values(txid_current(),'hot_classroom',p_classroom_id,null);
  impact:=public.get_hot_archived_classroom_purge_inventory(p_teacher_id,p_classroom_id);
  impact:=impact||jsonb_build_object('source_revision',p_expected_source_revision,'storage_inventory_sha256',p_expected_storage_inventory_sha256,'operational_inventory_sha256',p_expected_operational_inventory_sha256);
  request_sha:=private.repolight_digest_v1(jsonb_build_object('classroom_id',p_classroom_id,'teacher_id',p_teacher_id,'source_revision',p_expected_source_revision,'storage_inventory_sha256',p_expected_storage_inventory_sha256,'operational_inventory_sha256',p_expected_operational_inventory_sha256,'intent','delete_permanently'));
  result:=public.begin_hot_archived_classroom_purge(p_operation_id,p_teacher_id,p_classroom_id,request_sha,impact);
  if not coalesce((result->>'ok')::boolean,false) then raise exception using errcode='P2930',message='repolight_admission_rejected';end if;
  delete from private.repolight_purge_admissions where transaction_id=txid_current();
  if reservation.operation_id is null and not coalesce((result->>'replayed')::boolean,false) then perform private.capture_repolight_purge_subjects_v1(p_operation_id,'hot_classroom',fingerprint,p_classroom_id,null);end if;
 exception when sqlstate 'P2930' then return result;
 end;
 return result;
end $$;

create function private.repolight_purge_pending_v1(p_operation_id uuid,p_teacher_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.repolight_purge_subjects s join private.repolight_subject_bindings b on b.id=s.binding_id where s.operation_id=p_operation_id and b.state<>'erased' and (exists(select 1 from public.student_purge_operations op where op.id=s.operation_id and op.teacher_id=p_teacher_id) or exists(select 1 from public.classroom_purge_operations op where op.id=s.operation_id and op.teacher_id=p_teacher_id and op.purge_scope='hot_classroom')))
 or exists(select 1 from public.student_purge_operations op join private.repolight_subject_bindings b on b.classroom_id=op.classroom_id and b.student_id=op.student_id where op.id=p_operation_id and op.teacher_id=p_teacher_id and b.state<>'erased')
 or exists(select 1 from public.classroom_purge_operations op join private.repolight_subject_bindings b on b.classroom_id=op.classroom_id where op.id=p_operation_id and op.teacher_id=p_teacher_id and op.purge_scope='hot_classroom' and b.state<>'erased')
$$;
create function public.read_repolight_purge_cleanup_subjects_v1(p_actor_id uuid,p_operation_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.student_purge_operations op where op.id=p_operation_id and op.teacher_id=p_actor_id) and not exists(select 1 from public.classroom_purge_operations op where op.id=p_operation_id and op.teacher_id=p_actor_id and op.purge_scope='hot_classroom') then raise exception using errcode='42501',message='Forbidden';end if;
 if not exists(select 1 from private.repolight_purge_reservations where operation_id=p_operation_id and kind in('student','hot_classroom','removed_provider')) then
  if private.repolight_purge_pending_v1(p_operation_id,p_actor_id) then raise exception using errcode='55000',message='repolight_legacy_adoption_required';end if;
  return '[]'::jsonb;
 end if;
 return coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at,q.id) from (select b.* from private.repolight_purge_subjects s join private.repolight_subject_bindings b on b.id=s.binding_id where s.operation_id=p_operation_id and b.state<>'erased' order by b.created_at,b.id limit 100)q),'[]'::jsonb);
end $$;

alter function public.claim_student_purge_object(uuid,uuid,integer) rename to claim_student_purge_object_before_repolight_293;
create function public.claim_student_purge_object(p_operation_id uuid,p_teacher_id uuid,p_lease_seconds integer default 60) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if private.repolight_purge_pending_v1(p_operation_id,p_teacher_id) then return jsonb_build_object('ok',true,'status',202,'operation_id',p_operation_id,'operation_status',(select status from public.student_purge_operations where id=p_operation_id and teacher_id=p_teacher_id),'waiting_for_repolight',true);end if;
 return public.claim_student_purge_object_before_repolight_293(p_operation_id,p_teacher_id,p_lease_seconds);
end $$;
alter function public.finalize_student_purge(uuid,uuid) rename to finalize_student_purge_before_repolight_293;
create function public.finalize_student_purge(p_operation_id uuid,p_teacher_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if private.repolight_purge_pending_v1(p_operation_id,p_teacher_id) then return jsonb_build_object('ok',false,'status',409,'error_code','repolight_erasure_required','error','RepoLight cleanup is incomplete','retryable',true);end if;
 return public.finalize_student_purge_before_repolight_293(p_operation_id,p_teacher_id);
end $$;
alter function public.claim_classroom_purge_object(uuid,uuid,uuid,integer) rename to claim_classroom_purge_object_before_repolight_293;
create function public.claim_classroom_purge_object(p_operation_id uuid,p_teacher_id uuid,p_lease_token uuid,p_lease_seconds integer default 60) returns setof public.classroom_purge_objects language plpgsql security definer set search_path='' as $$
begin
 if private.repolight_purge_pending_v1(p_operation_id,p_teacher_id) then return;end if;
 return query select * from public.claim_classroom_purge_object_before_repolight_293(p_operation_id,p_teacher_id,p_lease_token,p_lease_seconds);
end $$;
alter function public.finalize_hot_archived_classroom_purge(uuid,uuid) rename to finalize_hot_archived_classroom_purge_before_repolight_293;
create function public.finalize_hot_archived_classroom_purge(p_operation_id uuid,p_teacher_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if private.repolight_purge_pending_v1(p_operation_id,p_teacher_id) then return jsonb_build_object('ok',false,'status',409,'error_code','repolight_erasure_required','error','RepoLight cleanup is incomplete','retryable',true);end if;
 return public.finalize_hot_archived_classroom_purge_before_repolight_293(p_operation_id,p_teacher_id);
end $$;
revoke all on function private.repolight_purge_snapshot_immutable_v1(),private.capture_repolight_purge_subjects_v1(uuid,text,text,uuid,uuid),private.repolight_purge_pending_v1(uuid,uuid),public.begin_student_purge_before_repolight_293(uuid,uuid,uuid,uuid,text,bigint,text,text),public.claim_student_purge_object_before_repolight_293(uuid,uuid,integer),public.finalize_student_purge_before_repolight_293(uuid,uuid),public.claim_classroom_purge_object_before_repolight_293(uuid,uuid,uuid,integer),public.finalize_hot_archived_classroom_purge_before_repolight_293(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.begin_student_purge(uuid,uuid,uuid,uuid,text,bigint,text,text),public.reserve_repolight_hot_classroom_purge_v1(uuid,uuid,uuid,text,bigint,text,text),public.read_repolight_purge_cleanup_subjects_v1(uuid,uuid),public.claim_student_purge_object(uuid,uuid,integer),public.finalize_student_purge(uuid,uuid),public.claim_classroom_purge_object(uuid,uuid,uuid,integer),public.finalize_hot_archived_classroom_purge(uuid,uuid) from public,anon,authenticated;
grant execute on function public.begin_student_purge(uuid,uuid,uuid,uuid,text,bigint,text,text),public.reserve_repolight_hot_classroom_purge_v1(uuid,uuid,uuid,text,bigint,text,text),public.read_repolight_purge_cleanup_subjects_v1(uuid,uuid),public.claim_student_purge_object(uuid,uuid,integer),public.finalize_student_purge(uuid,uuid),public.claim_classroom_purge_object(uuid,uuid,uuid,integer),public.finalize_hot_archived_classroom_purge(uuid,uuid) to service_role;

-- Eligibility is only a read projection. The original deletion_available remains
-- false until erasure. The exact-xid probe is removed before returning to callers.
alter function public.get_student_purge_inventory(uuid,uuid,uuid) rename to get_student_purge_inventory_before_repolight_293;
create function public.get_student_purge_inventory(p_teacher_id uuid,p_classroom_id uuid,p_student_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare original jsonb; candidate jsonb;
begin
 original:=public.get_student_purge_inventory_before_repolight_293(p_teacher_id,p_classroom_id,p_student_id);
 if not exists(select 1 from private.repolight_purge_admissions where transaction_id=txid_current()) and original->>'conflicting_operation'='repolight_erasure_required' then
  insert into private.repolight_purge_admissions values(txid_current(),'student',p_classroom_id,p_student_id);
  candidate:=public.get_student_purge_inventory_before_repolight_293(p_teacher_id,p_classroom_id,p_student_id);
  delete from private.repolight_purge_admissions where transaction_id=txid_current();
  return original||jsonb_build_object('can_reserve_cleanup',coalesce((candidate->>'deletion_available')::boolean,false) and not public.attendance_student_has_state_v1(p_classroom_id,p_student_id),'cleanup_unavailable_reason',case when public.attendance_student_has_state_v1(p_classroom_id,p_student_id) then 'attendance_student_decommission_required' else candidate->>'unavailable_reason' end);
 end if;
 return original||jsonb_build_object('can_reserve_cleanup',false);
end $$;
alter function public.get_hot_archived_classroom_purge_inventory(uuid,uuid) rename to get_hot_archived_classroom_purge_inventory_before_repolight_293;
create function public.get_hot_archived_classroom_purge_inventory(p_teacher_id uuid,p_classroom_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare original jsonb; candidate jsonb;
begin
 original:=public.get_hot_archived_classroom_purge_inventory_before_repolight_293(p_teacher_id,p_classroom_id);
 if not exists(select 1 from private.repolight_purge_admissions where transaction_id=txid_current()) and original->>'conflicting_operation'='repolight_erasure_required' then
  insert into private.repolight_purge_admissions values(txid_current(),'hot_classroom',p_classroom_id,null);
  candidate:=public.get_hot_archived_classroom_purge_inventory_before_repolight_293(p_teacher_id,p_classroom_id);
  delete from private.repolight_purge_admissions where transaction_id=txid_current();
  return original||jsonb_build_object('can_reserve_cleanup',coalesce((candidate->>'deletion_available')::boolean,false),'cleanup_unavailable_reason',candidate->>'unavailable_reason');
 end if;
 return original||jsonb_build_object('can_reserve_cleanup',false);
end $$;
revoke all on function public.get_student_purge_inventory_before_repolight_293(uuid,uuid,uuid),public.get_hot_archived_classroom_purge_inventory_before_repolight_293(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_student_purge_inventory(uuid,uuid,uuid),public.get_hot_archived_classroom_purge_inventory(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_student_purge_inventory(uuid,uuid,uuid),public.get_hot_archived_classroom_purge_inventory(uuid,uuid) to service_role;
-- Explicit removed-member cleanup and assignment Delete intents. These are
-- provider-copy prerequisites, not Pal/Bara operations or generic reset actions.
alter table private.repolight_purge_reservations drop constraint repolight_purge_reservations_kind_check;
alter table private.repolight_purge_reservations add constraint repolight_purge_reservations_kind_check check(kind in('student','hot_classroom','removed_student','assignment_delete'));
create table private.repolight_decommission_intents(
 operation_id uuid primary key references private.repolight_purge_reservations(operation_id),
 teacher_id uuid references public.users(id) on delete set null,
 kind text not null check(kind in('removed_student','assignment_delete')),
 target_digest text not null check(target_digest ~ '^[a-f0-9]{64}$'),
 classroom_id uuid,student_id uuid,generation_id uuid,assignment_id uuid,
 assignment_updated_at timestamptz,source_fingerprint text,
 status text not null default 'cleanup_pending' check(status in('cleanup_pending','completed')),completion_ack jsonb,
 created_at timestamptz not null default clock_timestamp(),completed_at timestamptz,
 check(status='completed' or (teacher_id is not null and classroom_id is not null)),
 check(status='completed' or (kind='removed_student' and student_id is not null and generation_id is not null) or (kind='assignment_delete' and assignment_id is not null and assignment_updated_at is not null and source_fingerprint ~ '^[a-f0-9]{64}$')),
 check((status='completed')=(completed_at is not null))
);
create unique index repolight_assignment_delete_pending on private.repolight_decommission_intents(assignment_id) where kind='assignment_delete' and status='cleanup_pending';
alter table private.repolight_decommission_intents enable row level security;
revoke all on private.repolight_decommission_intents from public,anon,authenticated,service_role;
create table private.repolight_assignment_delete_capabilities(transaction_id bigint primary key,operation_id uuid not null references private.repolight_decommission_intents(operation_id),assignment_id uuid not null);
alter table private.repolight_assignment_delete_capabilities enable row level security;
revoke all on private.repolight_assignment_delete_capabilities from public,anon,authenticated,service_role;
create function private.repolight_decommission_intent_guard_v1() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or (to_jsonb(new)-array['status','completed_at','classroom_id','student_id','generation_id','assignment_id','teacher_id','completion_ack']) is distinct from (to_jsonb(old)-array['status','completed_at','classroom_id','student_id','generation_id','assignment_id','teacher_id','completion_ack'])
 or (old.status='completed' and (new.status<>'completed' or new.completion_ack is distinct from old.completion_ack))
 or (new.teacher_id is distinct from old.teacher_id and not(new.teacher_id is null and new.status='completed' and not exists(select 1 from public.users where id=old.teacher_id)))
 or ((new.classroom_id,new.student_id,new.generation_id,new.assignment_id) is distinct from (old.classroom_id,old.student_id,old.generation_id,old.assignment_id) and not(new.status='completed' and new.classroom_id is null and new.student_id is null and new.generation_id is null and new.assignment_id is null)) then raise exception using errcode='55000',message='repolight_decommission_intent_immutable';end if;
 return new;
end $$;
create trigger repolight_decommission_intent_immutable before update or delete on private.repolight_decommission_intents for each row execute function private.repolight_decommission_intent_guard_v1();
create function private.repolight_decommission_status_v1(p_operation_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('operation_id',i.operation_id,'kind',i.kind,'status',i.status,'pending_subject_count',(select count(*) from private.repolight_purge_subjects s join private.repolight_subject_bindings b on b.id=s.binding_id where s.operation_id=i.operation_id and b.state<>'erased')) from private.repolight_decommission_intents i where i.operation_id=p_operation_id
$$;
create function private.capture_repolight_decommission_subjects_v1(p_operation_id uuid,p_classroom_id uuid,p_student_id uuid,p_generation_id uuid,p_assignment_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 update private.repolight_subject_bindings set state='erasing',operation_id=coalesce(operation_id,gen_random_uuid())
 where classroom_id=p_classroom_id and (p_student_id is null or student_id=p_student_id) and (p_generation_id is null or enrollment_id=p_generation_id) and (p_assignment_id is null or assignment_id=p_assignment_id) and state<>'erased';
 insert into private.repolight_purge_subjects(operation_id,binding_id,erasure_operation_id,connection_ref,workspace_ref,installation_ref,subject_ref)
 select p_operation_id,id,operation_id,connection_ref,workspace_ref,installation_ref,subject_ref from private.repolight_subject_bindings
 where classroom_id=p_classroom_id and (p_student_id is null or student_id=p_student_id) and (p_generation_id is null or enrollment_id=p_generation_id) and (p_assignment_id is null or assignment_id=p_assignment_id) and state<>'erased';
end $$;
create function public.reserve_repolight_removed_student_cleanup_v1(p_operation_id uuid,p_actor_id uuid,p_classroom_id uuid,p_student_id uuid,p_generation_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare fingerprint text; previous private.repolight_purge_reservations; first_row public.classroom_roster; roster_ids uuid[]; eligible timestamptz;
begin
 if p_operation_id is null or p_actor_id is null or p_classroom_id is null or p_student_id is null or p_generation_id is null then raise exception using errcode='22023',message='repolight_cleanup_binding_invalid';end if;
 perform private.try_lock_classroom_membership_change(p_classroom_id,p_student_id);
 perform pg_advisory_xact_lock(hashtextextended('pika-classroom-operation:'||p_classroom_id::text,0));
 if not exists(select 1 from public.classrooms where id=p_classroom_id and teacher_id=p_actor_id) then raise exception using errcode='42501',message='Forbidden';end if;
 -- This explicit action erases only RepoLight; other providers stay out of scope.
 perform public.get_repolight_removed_student_cleanup_context_v1(p_actor_id,p_classroom_id,p_student_id,p_generation_id);
 fingerprint:=private.repolight_digest_v1(jsonb_build_array(p_actor_id,p_classroom_id,p_student_id,p_generation_id));
 select * into previous from private.repolight_purge_reservations where operation_id=p_operation_id;
 if found then
  if previous.kind<>'removed_student' or previous.request_fingerprint<>fingerprint or not exists(select 1 from private.repolight_decommission_intents where operation_id=p_operation_id and teacher_id=p_actor_id) then raise exception using errcode='40001',message='repolight_cleanup_binding_invalid';end if;
  return private.repolight_decommission_status_v1(p_operation_id);
 end if;
 select eligible_after into eligible from private.student_provider_cleanup_settings where singleton and live_enabled for share;
 if eligible is null then raise exception using errcode='55000',message='student_live_cleanup_disabled';end if;
 if p_actor_id=p_student_id or exists(select 1 from public.classroom_enrollments where classroom_id=p_classroom_id and student_id=p_student_id) then raise exception using errcode='55000',message='retained_roster_cleanup_group_invalid';end if;
 perform 1 from public.classroom_roster where classroom_id=p_classroom_id and removed_student_id=p_student_id order by id for update;
 select array_agg(id order by id) into roster_ids from public.classroom_roster where classroom_id=p_classroom_id and removed_student_id=p_student_id;
 if coalesce(cardinality(roster_ids),0)=0 then raise exception using errcode='55000',message='retained_roster_cleanup_group_invalid';end if;
 select * into strict first_row from public.classroom_roster where id=roster_ids[1];
 if exists(select 1 from public.classroom_roster r left join public.classroom_roster_student_bindings b on b.roster_id=r.id where r.id=any(roster_ids) and (r.removed_enrollment_id is distinct from p_generation_id or r.removed_at is null or r.removed_at<eligible or r.removed_enrolled_at is null or r.retained_manual_attendance_marks is null or (r.removed_enrolled_at,r.removed_at,r.retained_attendance_participant_active) is distinct from (first_row.removed_enrolled_at,first_row.removed_at,first_row.retained_attendance_participant_active) or r.retained_manual_attendance_marks is distinct from first_row.retained_manual_attendance_marks or b.classroom_id is distinct from p_classroom_id or b.student_id is distinct from p_student_id))
 or exists(select 1 from public.classroom_roster_student_bindings b where b.classroom_id=p_classroom_id and b.student_id=p_student_id and not(b.roster_id=any(roster_ids)))
 or exists(select 1 from private.repolight_subject_bindings where classroom_id=p_classroom_id and student_id=p_student_id and state<>'erased' and enrollment_id is distinct from p_generation_id) then raise exception using errcode='55000',message='retained_roster_cleanup_group_invalid';end if;
 perform public.guard_classroom_purge_lifecycle(p_classroom_id);
 if public.classroom_purge_conflict_before_repolight_293(p_classroom_id) is not null or exists(select 1 from public.classroom_cold_tombstones where classroom_id=p_classroom_id) or exists(select 1 from public.student_purge_fences where classroom_id=p_classroom_id) then raise exception using errcode='55000',message='student_provider_operation_conflict';end if;
 insert into private.repolight_purge_reservations(operation_id,kind,request_fingerprint) values(p_operation_id,'removed_student',fingerprint);
 insert into private.repolight_decommission_intents(operation_id,teacher_id,kind,target_digest,classroom_id,student_id,generation_id) values(p_operation_id,p_actor_id,'removed_student',private.repolight_digest_v1(jsonb_build_array('removed_student',p_actor_id,p_classroom_id,p_student_id,p_generation_id)),p_classroom_id,p_student_id,p_generation_id);
 perform private.capture_repolight_decommission_subjects_v1(p_operation_id,p_classroom_id,p_student_id,p_generation_id,null);
 perform private.complete_repolight_removed_intent_v1(p_operation_id);
 return private.repolight_decommission_status_v1(p_operation_id);
end $$;

create function private.repolight_assignment_delete_source_v1(p_assignment_id uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('assignment',to_jsonb(a),'docs',coalesce((select jsonb_agg(to_jsonb(d) order by d.id) from public.assignment_docs d where d.assignment_id=a.id),'[]'::jsonb),'requirements',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from public.assignment_submission_requirements r where r.assignment_id=a.id),'[]'::jsonb),'artifacts',coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from public.assignment_submission_artifacts s join public.assignment_docs d on d.id=s.assignment_doc_id where d.assignment_id=a.id),'[]'::jsonb),'targets',coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.assignment_repo_targets t where t.assignment_id=a.id),'[]'::jsonb)) from public.assignments a where a.id=p_assignment_id
$$;
create function public.get_repolight_assignment_delete_context_v1(p_actor_id uuid,p_assignment_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.assignments; pending private.repolight_decommission_intents;
begin
 a:=private.lock_assignment_owner_mutation_context_v1(p_actor_id,p_assignment_id);
 select * into pending from private.repolight_decommission_intents where assignment_id=a.id and teacher_id=p_actor_id and kind='assignment_delete' and status='cleanup_pending';
 return jsonb_build_object('assignment_id',a.id,'classroom_id',a.classroom_id,'assignment_updated_at',coalesce(pending.assignment_updated_at,a.updated_at),'source_fingerprint',coalesce(pending.source_fingerprint,private.repolight_digest_v1(private.repolight_assignment_delete_source_v1(a.id))),'pending_operation_id',pending.operation_id,'subject_count',(select count(*) from private.repolight_subject_bindings where assignment_id=a.id and state<>'erased'));
end $$;
create function public.reserve_repolight_assignment_delete_v1(p_operation_id uuid,p_actor_id uuid,p_assignment_id uuid,p_expected_updated_at timestamptz,p_expected_source_fingerprint text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.assignments; fingerprint text; previous private.repolight_purge_reservations; pending private.repolight_decommission_intents;
begin
 fingerprint:=private.repolight_digest_v1(jsonb_build_array(p_actor_id,p_assignment_id,p_expected_updated_at,p_expected_source_fingerprint));
 select * into previous from private.repolight_purge_reservations where operation_id=p_operation_id;
 if found then
  if previous.kind<>'assignment_delete' or previous.request_fingerprint<>fingerprint or not exists(select 1 from private.repolight_decommission_intents where operation_id=p_operation_id and teacher_id=p_actor_id) then raise exception using errcode='40001',message='repolight_cleanup_binding_invalid';end if;
  if exists(select 1 from private.repolight_decommission_intents where operation_id=p_operation_id and status='cleanup_pending') then perform private.lock_assignment_owner_mutation_context_v1(p_actor_id,p_assignment_id);end if;
  return private.repolight_decommission_status_v1(p_operation_id);
 end if;
 a:=private.lock_assignment_owner_mutation_context_v1(p_actor_id,p_assignment_id);
 select * into pending from private.repolight_decommission_intents where assignment_id=a.id and teacher_id=p_actor_id and kind='assignment_delete' and status='cleanup_pending';
 if found then
  if pending.assignment_updated_at is distinct from p_expected_updated_at or pending.source_fingerprint is distinct from p_expected_source_fingerprint then raise exception using errcode='40001',message='repolight_source_changed';end if;
  return private.repolight_decommission_status_v1(pending.operation_id);
 end if;
 if p_operation_id is null or p_expected_updated_at is null or p_expected_source_fingerprint is null or a.updated_at is distinct from p_expected_updated_at or private.repolight_digest_v1(private.repolight_assignment_delete_source_v1(a.id)) is distinct from p_expected_source_fingerprint then raise exception using errcode='40001',message='repolight_source_changed';end if;
 perform public.guard_classroom_purge_lifecycle(a.classroom_id);
 if public.classroom_purge_conflict_before_repolight_293(a.classroom_id) is not null or exists(select 1 from public.student_purge_fences where classroom_id=a.classroom_id) then raise exception using errcode='55000',message='repolight_cleanup_operation_conflict';end if;
 insert into private.repolight_purge_reservations(operation_id,kind,request_fingerprint) values(p_operation_id,'assignment_delete',fingerprint);
 insert into private.repolight_decommission_intents(operation_id,teacher_id,kind,target_digest,classroom_id,assignment_id,assignment_updated_at,source_fingerprint) values(p_operation_id,p_actor_id,'assignment_delete',private.repolight_digest_v1(jsonb_build_array('assignment_delete',p_actor_id,a.id)),a.classroom_id,a.id,a.updated_at,p_expected_source_fingerprint);
 perform private.capture_repolight_decommission_subjects_v1(p_operation_id,a.classroom_id,null,null,a.id);
 return private.repolight_decommission_status_v1(p_operation_id);
end $$;
create function public.read_repolight_decommission_subjects_v1(p_actor_id uuid,p_operation_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare i private.repolight_decommission_intents;
begin
 select * into i from private.repolight_decommission_intents where operation_id=p_operation_id and teacher_id=p_actor_id;
 if not found or (i.status<>'completed' and not exists(select 1 from public.classrooms where id=i.classroom_id and teacher_id=p_actor_id)) then raise exception using errcode='42501',message='Forbidden';end if;
 if i.status='completed' then return '[]'::jsonb;end if;
 return coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at,q.id) from (select b.* from private.repolight_purge_subjects s join private.repolight_subject_bindings b on b.id=s.binding_id where s.operation_id=p_operation_id and b.state<>'erased' order by b.created_at,b.id limit 100)q),'[]'::jsonb);
end $$;

create function private.repolight_assignment_delete_fence_v1() returns trigger language plpgsql security definer set search_path='' as $$
declare row_value jsonb; aid uuid; rows jsonb[];
begin
 rows:=case when tg_op='INSERT' then array[to_jsonb(new)] when tg_op='DELETE' then array[to_jsonb(old)] else array[to_jsonb(old),to_jsonb(new)] end;
 foreach row_value in array rows loop
  aid:=case when tg_table_name='assignments' then (row_value->>'id')::uuid else (row_value->>'assignment_id')::uuid end;
  if tg_table_name='assignment_submission_artifacts' then select assignment_id into aid from public.assignment_docs where id=(row_value->>'assignment_doc_id')::uuid;end if;
  if exists(select 1 from private.repolight_decommission_intents where assignment_id=aid and kind='assignment_delete' and status='cleanup_pending') and not exists(select 1 from private.repolight_assignment_delete_capabilities where transaction_id=txid_current() and assignment_id=aid) then raise exception using errcode='55000',message='repolight_assignment_delete_pending';end if;
 end loop;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger repolight_assignment_delete_fence before update or delete on public.assignments for each row execute function private.repolight_assignment_delete_fence_v1();
create trigger repolight_assignment_doc_delete_fence before insert or update or delete on public.assignment_docs for each row execute function private.repolight_assignment_delete_fence_v1();
create trigger repolight_assignment_requirement_delete_fence before insert or update or delete on public.assignment_submission_requirements for each row execute function private.repolight_assignment_delete_fence_v1();
create trigger repolight_assignment_artifact_delete_fence before insert or update or delete on public.assignment_submission_artifacts for each row execute function private.repolight_assignment_delete_fence_v1();
create trigger repolight_assignment_target_delete_fence before insert or update or delete on public.assignment_repo_targets for each row execute function private.repolight_assignment_delete_fence_v1();
create function public.finalize_repolight_assignment_delete_v1(p_actor_id uuid,p_operation_id uuid,p_assignment_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare i private.repolight_decommission_intents; a public.assignments; result jsonb;
begin
 select * into i from private.repolight_decommission_intents where operation_id=p_operation_id and teacher_id=p_actor_id and kind='assignment_delete' for update;
 if not found or i.target_digest is distinct from private.repolight_digest_v1(jsonb_build_array('assignment_delete',p_actor_id,p_assignment_id)) then raise exception using errcode='42501',message='Forbidden';end if;
 if i.status='completed' then return i.completion_ack||jsonb_build_object('replayed',true);end if;
 a:=private.lock_assignment_owner_mutation_context_v1(p_actor_id,i.assignment_id);
 if exists(select 1 from private.repolight_purge_subjects s join private.repolight_subject_bindings b on b.id=s.binding_id where s.operation_id=p_operation_id and b.state<>'erased') then raise exception using errcode='55000',message='repolight_erasure_required';end if;
 if a.updated_at is distinct from i.assignment_updated_at or private.repolight_digest_v1(private.repolight_assignment_delete_source_v1(a.id)) is distinct from i.source_fingerprint then raise exception using errcode='40001',message='repolight_source_changed';end if;
 insert into private.repolight_assignment_delete_capabilities values(txid_current(),p_operation_id,a.id);
 result:=public.delete_assignment_for_owner_v1(p_actor_id,a.id);
 delete from private.repolight_assignment_delete_capabilities where transaction_id=txid_current();
 update private.repolight_decommission_intents set status='completed',completed_at=clock_timestamp(),completion_ack=result,classroom_id=null,student_id=null,generation_id=null,assignment_id=null where operation_id=p_operation_id;
 return result;
end $$;
revoke all on function private.repolight_decommission_intent_guard_v1(),private.repolight_decommission_status_v1(uuid),private.capture_repolight_decommission_subjects_v1(uuid,uuid,uuid,uuid,uuid),private.repolight_assignment_delete_source_v1(uuid),private.repolight_assignment_delete_fence_v1() from public,anon,authenticated,service_role;
revoke all on function public.reserve_repolight_removed_student_cleanup_v1(uuid,uuid,uuid,uuid,uuid),public.get_repolight_assignment_delete_context_v1(uuid,uuid),public.reserve_repolight_assignment_delete_v1(uuid,uuid,uuid,timestamptz,text),public.read_repolight_decommission_subjects_v1(uuid,uuid),public.finalize_repolight_assignment_delete_v1(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserve_repolight_removed_student_cleanup_v1(uuid,uuid,uuid,uuid,uuid),public.get_repolight_assignment_delete_context_v1(uuid,uuid),public.reserve_repolight_assignment_delete_v1(uuid,uuid,uuid,timestamptz,text),public.read_repolight_decommission_subjects_v1(uuid,uuid),public.finalize_repolight_assignment_delete_v1(uuid,uuid,uuid) to service_role;

create function private.complete_repolight_removed_intent_v1(p_operation_id uuid) returns void language sql security definer set search_path='' as $$
 update private.repolight_decommission_intents i set status='completed',completed_at=clock_timestamp(),classroom_id=null,student_id=null,generation_id=null,assignment_id=null
 where i.kind='removed_student' and i.status='cleanup_pending' and (p_operation_id is null or i.operation_id=p_operation_id) and not exists(select 1 from private.repolight_purge_subjects s join private.repolight_subject_bindings b on b.id=s.binding_id where s.operation_id=i.operation_id and b.state<>'erased')
$$;
revoke all on function private.complete_repolight_removed_intent_v1(uuid) from public,anon,authenticated,service_role;

create function private.repolight_decommission_parent_guard_v1() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.repolight_decommission_intents where classroom_id=old.id and status='cleanup_pending') then raise exception using errcode='55000',message='repolight_decommission_pending';end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger repolight_decommission_classroom_guard before delete or update of teacher_id on public.classrooms for each row execute function private.repolight_decommission_parent_guard_v1();
revoke all on function private.repolight_decommission_parent_guard_v1() from public,anon,authenticated,service_role;
-- Manual mixed-provider admission: preserve the complete original live cleanup
-- chain, temporarily ignoring only RepoLight's prerequisite in this exact xid.
-- Automatic callers must inspect read-only presence and stop before reservation.
alter table private.repolight_purge_reservations drop constraint repolight_purge_reservations_kind_check;
alter table private.repolight_purge_reservations add constraint repolight_purge_reservations_kind_check check(kind in('student','hot_classroom','removed_provider','removed_student','assignment_delete'));
alter function private.reserve_live_student_cleanup(uuid,uuid,uuid,uuid,uuid) rename to reserve_live_student_cleanup_before_repolight_293;
create function private.reserve_live_student_cleanup(p_operation_id uuid,p_teacher_id uuid,p_classroom_id uuid,p_student_id uuid,p_generation_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare fingerprint text; previous private.repolight_purge_reservations; result jsonb; existed boolean;
begin
 perform private.try_lock_classroom_membership_change(p_classroom_id,p_student_id);
 fingerprint:=private.repolight_digest_v1(jsonb_build_array(p_teacher_id,p_classroom_id,p_student_id,p_generation_id));
 select * into previous from private.repolight_purge_reservations where operation_id=p_operation_id;
 if found and (previous.kind<>'removed_provider' or previous.request_fingerprint<>fingerprint) then raise exception using errcode='40001',message='repolight_cleanup_binding_invalid';end if;
 select exists(select 1 from public.student_purge_operations where id=p_operation_id) into existed;
 if existed and previous.operation_id is null and exists(select 1 from private.repolight_subject_bindings where classroom_id=p_classroom_id and student_id=p_student_id and enrollment_id=p_generation_id and state<>'erased') then raise exception using errcode='55000',message='repolight_legacy_adoption_required';end if;
 begin
  insert into private.repolight_purge_admissions values(txid_current(),'student',p_classroom_id,p_student_id);
  result:=private.reserve_live_student_cleanup_before_repolight_293(p_operation_id,p_teacher_id,p_classroom_id,p_student_id,p_generation_id);
  delete from private.repolight_purge_admissions where transaction_id=txid_current();
  if not existed then
   if not exists(select 1 from public.student_purge_operations op join private.student_provider_cleanup_bindings b on b.operation_id=op.id where op.id=p_operation_id and op.teacher_id=p_teacher_id and op.classroom_id=p_classroom_id and op.student_id=p_student_id and b.generation_id=p_generation_id and op.status='provider_pending') then raise exception using errcode='55000',message='repolight_cleanup_binding_invalid';end if;
   insert into private.repolight_purge_reservations(operation_id,kind,request_fingerprint) values(p_operation_id,'removed_provider',fingerprint);
   perform private.capture_repolight_decommission_subjects_v1(p_operation_id,p_classroom_id,p_student_id,p_generation_id,null);
  end if;
 end;
 return result;
end $$;
revoke all on function private.reserve_live_student_cleanup_before_repolight_293(uuid,uuid,uuid,uuid,uuid),private.reserve_live_student_cleanup(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function public.get_repolight_removed_student_cleanup_context_v1(p_actor_id uuid,p_classroom_id uuid,p_student_id uuid,p_generation_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare first_row public.classroom_roster; ids uuid[]; generation uuid; bound boolean; saved private.repolight_decommission_intents; total_count bigint; pending_count bigint;
begin
 perform private.try_lock_classroom_membership_change(p_classroom_id,p_student_id);
 if p_actor_id is null or not exists(select 1 from public.classrooms where id=p_classroom_id and teacher_id=p_actor_id) then raise exception using errcode='42501',message='Forbidden';end if;
 if p_actor_id=p_student_id or exists(select 1 from public.classroom_enrollments where classroom_id=p_classroom_id and student_id=p_student_id) then raise exception using errcode='55000',message='retained_roster_cleanup_group_invalid';end if;
 select array_agg(id order by id) into ids from public.classroom_roster where classroom_id=p_classroom_id and removed_student_id=p_student_id;
 if coalesce(cardinality(ids),0)=0 then raise exception using errcode='55000',message='retained_roster_cleanup_group_invalid';end if;
 select * into strict first_row from public.classroom_roster where id=ids[1];generation:=coalesce(p_generation_id,first_row.removed_enrollment_id);
 if generation is null or exists(select 1 from public.classroom_roster r left join public.classroom_roster_student_bindings b on b.roster_id=r.id where r.id=any(ids) and (r.removed_enrollment_id is distinct from generation or r.removed_at is null or r.removed_enrolled_at is null or r.retained_manual_attendance_marks is null or (r.removed_enrolled_at,r.removed_at,r.retained_attendance_participant_active) is distinct from (first_row.removed_enrolled_at,first_row.removed_at,first_row.retained_attendance_participant_active) or r.retained_manual_attendance_marks is distinct from first_row.retained_manual_attendance_marks or b.classroom_id is distinct from p_classroom_id or b.student_id is distinct from p_student_id)) or exists(select 1 from public.classroom_roster_student_bindings b where b.classroom_id=p_classroom_id and b.student_id=p_student_id and not(b.roster_id=any(ids))) then raise exception using errcode='55000',message='retained_roster_cleanup_group_invalid';end if;
 bound:=exists(select 1 from private.pal_membership_generations where generation_id=generation) or exists(select 1 from private.attendance_membership_generations where generation_id=generation) or exists(select 1 from private.student_provider_cleanup_bindings where generation_id=generation);
 select * into saved from private.repolight_decommission_intents where teacher_id=p_actor_id and kind='removed_student' and target_digest=private.repolight_digest_v1(jsonb_build_array('removed_student',p_actor_id,p_classroom_id,p_student_id,generation)) order by created_at limit 1;
 if saved.operation_id is null then
  select count(*),count(*) filter(where state<>'erased') into total_count,pending_count from private.repolight_subject_bindings where classroom_id=p_classroom_id and student_id=p_student_id and enrollment_id=generation;
 else
  select count(*),count(*) filter(where b.state<>'erased') into total_count,pending_count from private.repolight_purge_subjects s join private.repolight_subject_bindings b on b.id=s.binding_id where s.operation_id=saved.operation_id;
 end if;
 return jsonb_build_object('schema_version',1,'classroom_id',p_classroom_id,'student_id',p_student_id,'generation_id',generation,'email',first_row.email,'name',coalesce(nullif(btrim(concat_ws(' ',first_row.first_name,first_row.last_name)),''),first_row.email),'scope','repolight_only','other_providers','out_of_scope','provider_bound',bound,'operation_id',saved.operation_id,'status',coalesce(saved.status,'not_reserved'),'pending_subject_count',pending_count,'total_subject_count',total_count,'academic_preserved',true);
end $$;
create function public.discover_repolight_removed_student_cleanup_groups_v1(p_actor_id uuid,p_classroom_id uuid,p_after_student_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare item record; context jsonb; targets jsonb:='[]'::jsonb; next_id uuid; seen integer:=0; last_id uuid;
begin
 if p_actor_id is null or not exists(select 1 from public.classrooms where id=p_classroom_id and teacher_id=p_actor_id) then raise exception using errcode='42501',message='Forbidden';end if;
 for item in select distinct r.removed_student_id student_id from public.classroom_roster r where r.classroom_id=p_classroom_id and r.removed_student_id is not null and (p_after_student_id is null or r.removed_student_id>p_after_student_id) and
 (exists(select 1 from private.repolight_subject_bindings b where b.classroom_id=r.classroom_id and b.student_id=r.removed_student_id and b.enrollment_id=r.removed_enrollment_id)
 or exists(select 1 from private.repolight_decommission_intents i where i.teacher_id=p_actor_id and i.kind='removed_student' and i.target_digest=private.repolight_digest_v1(jsonb_build_array('removed_student',p_actor_id,r.classroom_id,r.removed_student_id,r.removed_enrollment_id)))) order by r.removed_student_id limit 101 loop
  if seen=100 then next_id:=last_id;exit;end if;
  context:=public.get_repolight_removed_student_cleanup_context_v1(p_actor_id,p_classroom_id,item.student_id,null);
  targets:=targets||jsonb_build_array(context);seen:=seen+1;last_id:=item.student_id;
 end loop;
 return jsonb_build_object('schema_version',1,'teacher_id',p_actor_id,'classroom_id',p_classroom_id,'after_student_id',p_after_student_id,'targets',targets,'target_count',seen,'next_student_id',next_id);
end $$;
revoke all on function public.get_repolight_removed_student_cleanup_context_v1(uuid,uuid,uuid,uuid),public.discover_repolight_removed_student_cleanup_groups_v1(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_repolight_removed_student_cleanup_context_v1(uuid,uuid,uuid,uuid),public.discover_repolight_removed_student_cleanup_groups_v1(uuid,uuid,uuid) to service_role;
-- Automatic authority never expands to a new RepoLight erasure. The zero-copy
-- check and original reservation share both locks; the resulting parent fence
-- prevents a new Analyze after commit. All provider/retention gates still apply.
create function public.reserve_automatic_live_student_cleanup_v1(p_operation_id uuid,p_teacher_id uuid,p_classroom_id uuid,p_student_id uuid,p_generation_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.try_lock_classroom_membership_change(p_classroom_id,p_student_id);
 perform pg_advisory_xact_lock(hashtextextended('pika-classroom-operation:'||p_classroom_id::text,0));
 if not exists(select 1 from public.classrooms where id=p_classroom_id and teacher_id=p_teacher_id) then raise exception using errcode='42501',message='Forbidden';end if;
 perform 1 from private.student_provider_cleanup_settings where singleton and automatic_enabled for share;
 if not found then raise exception using errcode='55000',message='student_automatic_cleanup_disabled';end if;
 if exists(select 1 from private.repolight_subject_bindings where classroom_id=p_classroom_id and student_id=p_student_id and state<>'erased') then raise exception using errcode='55000',message='repolight_manual_cleanup_required';end if;
 return private.reserve_live_student_cleanup(p_operation_id,p_teacher_id,p_classroom_id,p_student_id,p_generation_id);
end $$;
revoke all on function public.reserve_automatic_live_student_cleanup_v1(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserve_automatic_live_student_cleanup_v1(uuid,uuid,uuid,uuid,uuid) to service_role;

commit;
