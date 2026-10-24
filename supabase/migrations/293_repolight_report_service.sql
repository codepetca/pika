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
 attempt_count integer not null default 0 check(attempt_count between 0 and 3),next_retry_at timestamptz,
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
  return to_jsonb(r);
 end if;
 if exists(select 1 from private.repolight_subject_bindings where intent_id=p_request_id) then raise exception using errcode='55000',message='repolight_subject_closed';end if;
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
 select * into b from private.repolight_subject_bindings where id=r.subject_binding_id for update;
 if b.state<>'active' then raise exception using errcode='55000',message='repolight_subject_closed';end if;
 if r.source_json is distinct from private.repolight_source_v1(p_assignment_id,p_student_id) then raise exception using errcode='40001',message='repolight_source_changed';end if;
 if r.status in('completed','failed','stale') then return to_jsonb(r);end if;
 if p_action='claim' then
  if r.lease_expires_at>clock_timestamp() or r.next_retry_at>clock_timestamp() then return to_jsonb(r)-'lease_token';end if;
  if r.attempt_count>=3 or r.created_at<clock_timestamp()-interval '24 hours' then
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
  can_retry:=coalesce((p_payload->>'retryable')::boolean,false) and r.attempt_count<3;
  if r.analysis_id is not null then update public.assignment_repolight_runs set attempt_count=least(3,attempt_count+1) where id=r.id;end if;
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
  if tg_op='UPDATE' and (to_jsonb(new)-array['analysis_id','status','attempt_count','next_retry_at','lease_token','lease_generation','lease_expires_at','error_code','completed_at']) is distinct from (to_jsonb(old)-array['analysis_id','status','attempt_count','next_retry_at','lease_token','lease_generation','lease_expires_at','error_code','completed_at']) then raise exception using errcode='55000',message='repolight_input_immutable';end if;
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
 select coalesce(jsonb_agg(to_jsonb(b) order by b.created_at,b.id),'[]'::jsonb) into value from private.repolight_subject_bindings b join public.classrooms c on c.id=b.classroom_id
 where b.teacher_id=p_actor_id and c.teacher_id=p_actor_id and b.state<>'erased' and (p_classroom_id is null or b.classroom_id=p_classroom_id) and (p_student_id is null or b.student_id=p_student_id) and (p_assignment_id is null or b.assignment_id=p_assignment_id);
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
commit;
