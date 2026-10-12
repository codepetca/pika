-- Dormant shared-admission Survey workflow. No account-role or cohort changes.
-- Existing legacy table writers are fenced by the archive-revision row which
-- their BEFORE resource triggers update. NOWAIT avoids their inverse row order.
begin;

create function private.lock_survey_context_v1(
  p_actor_id uuid, p_classroom_id uuid, p_survey_id uuid,
  p_member boolean, p_mutating boolean
) returns public.classrooms language plpgsql security invoker set search_path = '' as $function$
declare
  v_classroom_id uuid := p_classroom_id;
  v_classroom public.classrooms%rowtype;
  v_survey public.surveys%rowtype;
  v_subject uuid;
begin
  if p_actor_id is null or p_member is null or p_mutating is null
    or (p_classroom_id is null and p_survey_id is null) then
    raise exception using errcode='PT400', message='survey_invalid_context';
  end if;
  if p_survey_id is not null then
    select classroom_id into v_classroom_id from public.surveys where id=p_survey_id;
    if not found then raise exception using errcode='PT404', message='survey_not_found'; end if;
    if p_classroom_id is not null and p_classroom_id is distinct from v_classroom_id then
      raise exception using errcode='PT409', message='survey_parent_changed';
    end if;
  end if;
  perform private.try_lock_classroom_membership_change(v_classroom_id,
    case when p_member then p_actor_id else null end);
  perform public.guard_classroom_purge_lifecycle(v_classroom_id);
  if coalesce(public.is_classroom_archive_maintenance_mode('restore'), false)
    or coalesce(public.is_classroom_archive_maintenance_mode('compaction'), false) then
    raise exception using errcode='PT409', message='survey_classroom_fenced';
  end if;
  select * into v_classroom from public.classrooms where id=v_classroom_id for update nowait;
  if not found then raise exception using errcode='PT404', message='survey_classroom_not_found'; end if;
  if (p_member and v_classroom.teacher_id=p_actor_id)
    or (not p_member and v_classroom.teacher_id is distinct from p_actor_id)
    or ((p_member or p_mutating) and v_classroom.archived_at is not null) then
    raise exception using errcode='PT403', message='survey_forbidden';
  end if;
  -- Every Survey/question/response legacy write updates this row before its
  -- payload changes. Holding it gives one stable source snapshot without a new
  -- revision column or advisory-only protection of legacy direct writers.
  perform 1 from public.classroom_archive_revisions where classroom_id=v_classroom_id for update nowait;
  if not found then raise exception using errcode='PT503', message='survey_revision_unavailable'; end if;
  if p_member then
    perform 1 from public.classroom_enrollments where classroom_id=v_classroom_id and student_id=p_actor_id for share nowait;
    if not found then raise exception using errcode='PT403', message='survey_not_enrolled'; end if;
    if exists(select 1 from public.student_purge_fences where classroom_id=v_classroom_id and student_id=p_actor_id) then
      raise exception using errcode='PT409', message='survey_subject_fenced';
    end if;
  else
    -- Include removed response subjects before cascades; deleting their parent
    -- otherwise makes the response trigger's parent lookup unavailable.
    for v_subject in
      select student_id from public.classroom_enrollments where classroom_id=v_classroom_id
      union
      select response.student_id from public.survey_responses response
        join public.surveys survey on survey.id=response.survey_id
        where survey.classroom_id=v_classroom_id and (p_survey_id is null or survey.id=p_survey_id)
      order by student_id
    loop
      perform private.try_lock_classroom_membership_change(v_classroom_id,v_subject);
      if exists(select 1 from public.student_purge_fences where classroom_id=v_classroom_id and student_id=v_subject) then
        raise exception using errcode='PT409', message='survey_subject_fenced';
      end if;
    end loop;
  end if;
  if p_survey_id is not null then
    select * into v_survey from public.surveys where id=p_survey_id for update nowait;
    if not found or v_survey.classroom_id is distinct from v_classroom_id then
      raise exception using errcode='PT409', message='survey_parent_changed';
    end if;
  end if;
  return v_classroom;
exception when sqlstate '40001' or sqlstate '40P01' or sqlstate '55P03' or sqlstate '55000' then
  raise exception using errcode='PT409', message='survey_operation_busy';
end;
$function$;
revoke all on function private.lock_survey_context_v1(uuid,uuid,uuid,boolean,boolean) from public,anon,authenticated,service_role;

create function private.survey_classroom_json_v1(p_classroom public.classrooms)
returns jsonb language sql immutable security invoker set search_path = '' as $function$
  select jsonb_build_object('id',p_classroom.id,'teacher_id',p_classroom.teacher_id,'archived_at',p_classroom.archived_at)
$function$;
revoke all on function private.survey_classroom_json_v1(public.classrooms) from public,anon,authenticated,service_role;

create function private.survey_detail_v1(p_actor_id uuid,p_survey_id uuid,p_member boolean)
returns jsonb language plpgsql security invoker set search_path = '' as $function$
declare
  v_classroom public.classrooms;
  v_survey public.surveys;
  v_questions jsonb;
  v_responses jsonb := '[]'::jsonb;
  v_answered boolean;
  v_now timestamptz := clock_timestamp();
begin
  v_classroom := private.lock_survey_context_v1(p_actor_id,null,p_survey_id,p_member,false);
  v_now:=clock_timestamp();
  select * into strict v_survey from public.surveys where id=p_survey_id;
  if p_member then
    select exists(select 1 from public.survey_responses where survey_id=p_survey_id and student_id=p_actor_id) into v_answered;
    if v_survey.status='draft' or (v_survey.status='active' and v_survey.opens_at>v_now and not v_answered)
      or (v_survey.status='closed' and not v_answered and not v_survey.show_results) then
      raise exception using errcode='PT404', message='survey_not_found';
    end if;
    select coalesce(jsonb_agg(to_jsonb(response) order by response.question_id),'[]'::jsonb) into v_responses
      from public.survey_responses response where survey_id=p_survey_id and student_id=p_actor_id;
  end if;
  select coalesce(jsonb_agg(to_jsonb(question) order by position,id),'[]'::jsonb) into v_questions
    from public.survey_questions question where survey_id=p_survey_id;
  if jsonb_array_length(v_questions)>10000 or jsonb_array_length(v_responses)>10000 then
    raise exception using errcode='PT503', message='survey_payload_limit';
  end if;
  if octet_length(v_questions::text)+octet_length(v_responses::text)+octet_length(to_jsonb(v_survey)::text)>8388608 then
    raise exception using errcode='PT503', message='survey_payload_limit';
  end if;
  return jsonb_build_object('classroom',private.survey_classroom_json_v1(v_classroom),
    'survey',to_jsonb(v_survey),'questions',v_questions,'responses',v_responses);
end;
$function$;
revoke all on function private.survey_detail_v1(uuid,uuid,boolean) from public,anon,authenticated,service_role;

create function public.get_survey_for_owner_v1(p_actor_id uuid,p_survey_id uuid)
returns jsonb language sql security definer set search_path = '' set lock_timeout='1s' set statement_timeout='8s' as $function$
  select private.survey_detail_v1(p_actor_id,p_survey_id,false)
$function$;
create function public.get_survey_for_member_v1(p_actor_id uuid,p_survey_id uuid)
returns jsonb language sql security definer set search_path = '' set lock_timeout='1s' set statement_timeout='8s' as $function$
  select private.survey_detail_v1(p_actor_id,p_survey_id,true)
$function$;

create function private.survey_list_v1(p_actor_id uuid,p_classroom_id uuid,p_member boolean)
returns jsonb language plpgsql security invoker set search_path = '' as $function$
declare v_classroom public.classrooms; v_surveys jsonb; v_now timestamptz:=clock_timestamp();
begin
  v_classroom:=private.lock_survey_context_v1(p_actor_id,p_classroom_id,null,p_member,false);
  v_now:=clock_timestamp();
  select coalesce(jsonb_agg(payload order by position,created_at,id),'[]'::jsonb) into v_surveys from (
    select survey.position,survey.created_at,survey.id,
      to_jsonb(survey) || case when p_member then jsonb_build_object('has_submitted',exists(
        select 1 from public.survey_responses where survey_id=survey.id and student_id=p_actor_id))
      else jsonb_build_object('stats',jsonb_build_object(
        'total_students',(select count(*) from public.classroom_enrollments where classroom_id=p_classroom_id and student_id<>v_classroom.teacher_id),
        'questions_count',(select count(*) from public.survey_questions where survey_id=survey.id),
        'responded',(select count(distinct response.student_id) from public.survey_responses response
          join public.classroom_enrollments enrollment on enrollment.classroom_id=p_classroom_id and enrollment.student_id=response.student_id
          where response.survey_id=survey.id and enrollment.student_id<>v_classroom.teacher_id))) end as payload
    from public.surveys survey where classroom_id=p_classroom_id and (
      not p_member or (survey.status<>'draft' and (
        (survey.status='active' and (survey.opens_at is null or survey.opens_at<=v_now))
        or (survey.status='closed' and survey.show_results)
        or exists(select 1 from public.survey_responses where survey_id=survey.id and student_id=p_actor_id))))
  ) list;
  if jsonb_array_length(v_surveys)>10000 or octet_length(v_surveys::text)>8388608 then raise exception using errcode='PT503', message='survey_payload_limit'; end if;
  return jsonb_build_object('classroom',private.survey_classroom_json_v1(v_classroom),'surveys',v_surveys);
end;
$function$;
revoke all on function private.survey_list_v1(uuid,uuid,boolean) from public,anon,authenticated,service_role;
create function public.get_surveys_for_owner_v1(p_actor_id uuid,p_classroom_id uuid)
returns jsonb language sql security definer set search_path = '' set lock_timeout='1s' set statement_timeout='8s' as $function$
  select private.survey_list_v1(p_actor_id,p_classroom_id,false)
$function$;
create function public.get_surveys_for_member_v1(p_actor_id uuid,p_classroom_id uuid)
returns jsonb language sql security definer set search_path = '' set lock_timeout='1s' set statement_timeout='8s' as $function$
  select private.survey_list_v1(p_actor_id,p_classroom_id,true)
$function$;

create function private.survey_results_v1(p_actor_id uuid,p_survey_id uuid,p_member boolean)
returns jsonb language plpgsql security invoker set search_path = '' as $function$
declare
  v_classroom public.classrooms; v_survey public.surveys; v_results jsonb; v_questions jsonb;
  v_responders jsonb; v_total integer; v_responded integer; v_result jsonb; v_now timestamptz:=clock_timestamp();
begin
  v_classroom:=private.lock_survey_context_v1(p_actor_id,null,p_survey_id,p_member,false);
  v_now:=clock_timestamp();
  select * into strict v_survey from public.surveys where id=p_survey_id;
  if p_member and (not v_survey.show_results or v_survey.status='draft'
    or (v_survey.status='active' and v_survey.opens_at>v_now)) then
    raise exception using errcode='PT403', message='survey_results_unavailable';
  end if;
  with scoped as (
    select response.* from public.survey_responses response join public.classroom_enrollments enrollment
      on enrollment.classroom_id=v_classroom.id and enrollment.student_id=response.student_id
    where response.survey_id=p_survey_id and enrollment.student_id<>v_classroom.teacher_id
  ) select coalesce(jsonb_agg(jsonb_build_object(
    'question_id',question.id,'question_type',question.question_type,'question_text',question.question_text,
    'options',case when question.question_type='multiple_choice' then question.options else '[]'::jsonb end,
    'counts',case when question.question_type='multiple_choice' then (select coalesce(jsonb_agg(n order by index),'[]'::jsonb) from (
      select index,(select count(*) from scoped where question_id=question.id and selected_option=index) n
      from generate_series(0,jsonb_array_length(question.options)-1) index) counts) else '[]'::jsonb end,
    'total_responses',(select count(*) from scoped where question_id=question.id),
    'responses',case when question.question_type='multiple_choice' then '[]'::jsonb else (
      select coalesce(jsonb_agg(jsonb_build_object('response_id',response.id,'response_text',response.response_text,
        'submitted_at',response.submitted_at,'updated_at',response.updated_at) || case when p_member then '{}'::jsonb else
        jsonb_build_object('student_id',response.student_id,'name',nullif(btrim(concat_ws(' ',profile.first_name,profile.last_name)),''),'email',student.email) end
        order by response.id),'[]'::jsonb)
      from scoped response left join public.users student on student.id=response.student_id
      left join public.student_profiles profile on profile.user_id=response.student_id
      where response.question_id=question.id and response.response_text is not null and length(btrim(response.response_text))>0
    ) end) order by question.position,question.id),'[]'::jsonb) into v_results
    from public.survey_questions question where survey_id=p_survey_id;
  v_result:=jsonb_build_object('classroom',private.survey_classroom_json_v1(v_classroom),
    'survey',jsonb_build_object('id',v_survey.id,'title',v_survey.title,'status',v_survey.status,
      'show_results',v_survey.show_results,'dynamic_responses',v_survey.dynamic_responses),'results',v_results);
  if not p_member then
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'question_type',question_type,'question_text',question_text,
      'options',options,'response_max_chars',response_max_chars,'position',position) order by position,id),'[]'::jsonb)
      into v_questions from public.survey_questions where survey_id=p_survey_id;
    select count(*) into v_total from public.classroom_enrollments where classroom_id=v_classroom.id and student_id<>v_classroom.teacher_id;
    select coalesce(jsonb_agg(jsonb_build_object('student_id',student.id,'name',nullif(btrim(concat_ws(' ',profile.first_name,profile.last_name)),''),
      'email',student.email) order by coalesce(nullif(btrim(concat_ws(' ',profile.first_name,profile.last_name)),''),student.email),student.id),'[]'::jsonb)
      into v_responders from public.users student left join public.student_profiles profile on profile.user_id=student.id
      where student.id in (select distinct response.student_id from public.survey_responses response
        join public.classroom_enrollments enrollment on enrollment.classroom_id=v_classroom.id and enrollment.student_id=response.student_id
        where response.survey_id=p_survey_id and enrollment.student_id<>v_classroom.teacher_id);
    v_responded:=jsonb_array_length(v_responders);
    v_result:=v_result || jsonb_build_object('questions',v_questions,'responders',v_responders,
      'stats',jsonb_build_object('total_students',v_total,'responded',v_responded));
  end if;
  if jsonb_array_length(v_results)>10000 or octet_length(v_result::text)>8388608 then
    raise exception using errcode='PT503', message='survey_payload_limit';
  end if;
  return v_result;
end;
$function$;
revoke all on function private.survey_results_v1(uuid,uuid,boolean) from public,anon,authenticated,service_role;
create function public.get_survey_results_for_owner_v1(p_actor_id uuid,p_survey_id uuid)
returns jsonb language sql security definer set search_path = '' set lock_timeout='1s' set statement_timeout='8s' as $function$
  select private.survey_results_v1(p_actor_id,p_survey_id,false)
$function$;
create function public.get_survey_results_for_member_v1(p_actor_id uuid,p_survey_id uuid)
returns jsonb language sql security definer set search_path = '' set lock_timeout='1s' set statement_timeout='8s' as $function$
  select private.survey_results_v1(p_actor_id,p_survey_id,true)
$function$;

create function public.update_survey_for_owner_v1(p_actor_id uuid,p_survey_id uuid,p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout='1s' set statement_timeout='8s' as $function$
declare v_classroom public.classrooms; v_before public.surveys; v_after public.surveys; v_status text; v_now timestamptz:=clock_timestamp(); v_opens_at timestamptz;
begin
  v_classroom:=private.lock_survey_context_v1(p_actor_id,null,p_survey_id,false,true);
  v_now:=clock_timestamp();
  if p_patch is null or jsonb_typeof(p_patch)<>'object' or p_patch='{}'::jsonb or octet_length(p_patch::text)>4194304
    or exists(select 1 from jsonb_object_keys(p_patch) key where key not in ('title','status','show_results','dynamic_responses','opens_at'))
    or (p_patch?'title' and (jsonb_typeof(p_patch->'title')<>'string' or length(btrim(p_patch->>'title'))=0))
    or (p_patch?'status' and (jsonb_typeof(p_patch->'status')<>'string' or p_patch->>'status' not in ('draft','active','closed')))
    or (p_patch?'show_results' and jsonb_typeof(p_patch->'show_results')<>'boolean')
    or (p_patch?'dynamic_responses' and jsonb_typeof(p_patch->'dynamic_responses')<>'boolean')
    or (p_patch?'opens_at' and p_patch->'opens_at'<>'null'::jsonb and jsonb_typeof(p_patch->'opens_at')<>'string') then
    raise exception using errcode='PT400', message='survey_invalid_patch';
  end if;
  if p_patch?'opens_at' and p_patch->'opens_at'<>'null'::jsonb then
    begin
      v_opens_at:=(p_patch->>'opens_at')::timestamptz;
      if not isfinite(v_opens_at) then raise exception using errcode='PT400', message='survey_invalid_open_date'; end if;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception using errcode='PT400', message='survey_invalid_open_date';
    end;
  end if;
  select * into strict v_before from public.surveys where id=p_survey_id;
  v_status:=coalesce(p_patch->>'status',v_before.status);
  if p_patch?'status' then
    if not ((v_before.status='draft' and v_status='active') or (v_before.status='active' and v_status in ('closed','draft'))
      or (v_before.status='closed' and v_status='active'))
      or (v_before.status='active' and v_status='draft' and (v_before.opens_at is null or v_before.opens_at<=v_now))
      or (v_before.status='draft' and v_status='active' and not exists(select 1 from public.survey_questions where survey_id=p_survey_id)) then
      raise exception using errcode='PT400', message='survey_invalid_transition';
    end if;
  end if;
  update public.surveys set title=case when p_patch?'title' then p_patch->>'title' else title end,
    status=v_status,show_results=case when p_patch?'show_results' then (p_patch->>'show_results')::boolean else show_results end,
    dynamic_responses=case when p_patch?'dynamic_responses' then (p_patch->>'dynamic_responses')::boolean else dynamic_responses end,
    opens_at=case when p_patch->>'status'='draft' then null when p_patch->>'status'='active' then coalesce((p_patch->>'opens_at')::timestamptz,v_now)
      when p_patch?'opens_at' then (p_patch->>'opens_at')::timestamptz else opens_at end
    where id=p_survey_id and classroom_id=v_classroom.id returning * into v_after;
  if not found then raise exception using errcode='PT409', message='survey_parent_changed'; end if;
  if (v_after.id,v_after.classroom_id,v_after.created_by,v_after.created_at,v_after.position,
      v_after.artifact_id,v_after.source_artifact_id,v_after.source_blueprint_version_id,v_after.blueprint_archived_at)
    is distinct from (v_before.id,v_before.classroom_id,v_before.created_by,v_before.created_at,v_before.position,
      v_before.artifact_id,v_before.source_artifact_id,v_before.source_blueprint_version_id,v_before.blueprint_archived_at)
    or not exists(select 1 from public.surveys survey where id=p_survey_id and to_jsonb(survey)=to_jsonb(v_after)) then
    raise exception using errcode='PT409', message='survey_mutation_changed';
  end if;
  perform private.lock_survey_context_v1(p_actor_id,v_classroom.id,p_survey_id,false,true);
  return jsonb_build_object('survey',to_jsonb(v_after));
end;
$function$;

create function public.delete_survey_for_owner_v1(p_actor_id uuid,p_survey_id uuid)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout='1s' set statement_timeout='8s' as $function$
declare v_classroom public.classrooms;
begin
  v_classroom:=private.lock_survey_context_v1(p_actor_id,null,p_survey_id,false,true);
  delete from public.surveys where id=p_survey_id and classroom_id=v_classroom.id;
  if not found then raise exception using errcode='PT409', message='survey_parent_changed'; end if;
  if exists(select 1 from public.surveys where id=p_survey_id)
    or exists(select 1 from public.survey_questions where survey_id=p_survey_id)
    or exists(select 1 from public.survey_responses where survey_id=p_survey_id) then
    raise exception using errcode='PT409', message='survey_delete_changed';
  end if;
  perform private.lock_survey_context_v1(p_actor_id,v_classroom.id,null,false,true);
  return jsonb_build_object('success',true);
end;
$function$;

create function private.valid_survey_question_v1(p_question jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $function$
begin
  if p_question is null or jsonb_typeof(p_question)<>'object' or octet_length(p_question::text)>4194304
    or exists(select 1 from jsonb_object_keys(p_question) key where key not in ('question_type','question_text','options','response_max_chars','position'))
    or jsonb_typeof(p_question->'question_type') is distinct from 'string'
    or p_question->>'question_type' not in ('multiple_choice','short_text','link')
    or jsonb_typeof(p_question->'question_text') is distinct from 'string' or length(btrim(p_question->>'question_text'))=0
    or jsonb_typeof(p_question->'options') is distinct from 'array'
    or jsonb_typeof(p_question->'response_max_chars') is distinct from 'number'
    or (p_question->>'response_max_chars')::numeric<>trunc((p_question->>'response_max_chars')::numeric)
    or (p_question->>'response_max_chars')::numeric not between 1 and 5000
    or (p_question?'position' and (jsonb_typeof(p_question->'position')<>'number'
      or (p_question->>'position')::numeric<>trunc((p_question->>'position')::numeric)
      or (p_question->>'position')::numeric not between 0 and 2147483647)) then return false; end if;
  if p_question->>'question_type'='multiple_choice' then
    if jsonb_array_length(p_question->'options') not between 2 and 50 or exists(
      select 1 from jsonb_array_elements(p_question->'options') option where jsonb_typeof(option)<>'string' or length(btrim(option #>> '{}'))=0
    ) then return false; end if;
  elsif jsonb_array_length(p_question->'options')<>0 then return false; end if;
  return true;
exception when others then return false;
end;
$function$;
revoke all on function private.valid_survey_question_v1(jsonb) from public,anon,authenticated,service_role;

create function public.create_survey_question_for_owner_v1(p_actor_id uuid,p_survey_id uuid,p_question jsonb)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout='1s' set statement_timeout='8s' as $function$
declare v_classroom public.classrooms; v_question public.survey_questions; v_position integer;
begin
  v_classroom:=private.lock_survey_context_v1(p_actor_id,null,p_survey_id,false,true);
  if not private.valid_survey_question_v1(p_question) then raise exception using errcode='PT400', message='survey_invalid_question'; end if;
  select coalesce(max(position),-1)+1 into v_position from public.survey_questions where survey_id=p_survey_id;
  insert into public.survey_questions(survey_id,question_type,question_text,options,response_max_chars,position)
    values(p_survey_id,p_question->>'question_type',p_question->>'question_text',p_question->'options',
      (p_question->>'response_max_chars')::integer,coalesce((p_question->>'position')::integer,v_position)) returning * into v_question;
  if v_question.survey_id is distinct from p_survey_id or not exists(
    select 1 from public.survey_questions question where id=v_question.id and to_jsonb(question)=to_jsonb(v_question)) then
    raise exception using errcode='PT409', message='survey_question_changed';
  end if;
  perform private.lock_survey_context_v1(p_actor_id,v_classroom.id,p_survey_id,false,true);
  return jsonb_build_object('question',to_jsonb(v_question));
end;
$function$;

create function public.update_survey_question_for_owner_v1(p_actor_id uuid,p_survey_id uuid,p_question_id uuid,p_expected_question jsonb,p_question jsonb)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout='1s' set statement_timeout='8s' as $function$
declare v_classroom public.classrooms; v_question public.survey_questions; v_before public.survey_questions;
begin
  v_classroom:=private.lock_survey_context_v1(p_actor_id,null,p_survey_id,false,true);
  select * into v_question from public.survey_questions where id=p_question_id and survey_id=p_survey_id for update nowait;
  if not found then raise exception using errcode='PT404', message='survey_question_not_found'; end if;
  if p_expected_question is null or octet_length(p_expected_question::text)>8388608 or to_jsonb(v_question) is distinct from p_expected_question then
    raise exception using errcode='PT409', message='survey_question_changed';
  end if;
  v_before:=v_question;
  if not private.valid_survey_question_v1(p_question) then raise exception using errcode='PT400', message='survey_invalid_question'; end if;
  update public.survey_questions set question_type=p_question->>'question_type',question_text=p_question->>'question_text',
    options=p_question->'options',response_max_chars=(p_question->>'response_max_chars')::integer,
    position=coalesce((p_question->>'position')::integer,position)
    where id=p_question_id and survey_id=p_survey_id returning * into v_question;
  if (v_question.id,v_question.survey_id,v_question.created_at,v_question.artifact_id,v_question.source_artifact_id)
    is distinct from (v_before.id,v_before.survey_id,v_before.created_at,v_before.artifact_id,v_before.source_artifact_id)
    or not exists(select 1 from public.survey_questions question where id=p_question_id and to_jsonb(question)=to_jsonb(v_question)) then
    raise exception using errcode='PT409', message='survey_question_changed';
  end if;
  perform private.lock_survey_context_v1(p_actor_id,v_classroom.id,p_survey_id,false,true);
  return jsonb_build_object('question',to_jsonb(v_question));
exception when lock_not_available or deadlock_detected then raise exception using errcode='PT409', message='survey_operation_busy';
end;
$function$;

create function public.delete_survey_question_for_owner_v1(p_actor_id uuid,p_survey_id uuid,p_question_id uuid)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout='1s' set statement_timeout='8s' as $function$
declare v_classroom public.classrooms;
begin
  v_classroom:=private.lock_survey_context_v1(p_actor_id,null,p_survey_id,false,true);
  perform 1 from public.survey_questions where id=p_question_id and survey_id=p_survey_id for update nowait;
  if not found then raise exception using errcode='PT404', message='survey_question_not_found'; end if;
  delete from public.survey_questions where id=p_question_id and survey_id=p_survey_id;
  if exists(select 1 from public.survey_questions where id=p_question_id)
    or exists(select 1 from public.survey_responses where question_id=p_question_id) then
    raise exception using errcode='PT409', message='survey_question_delete_changed';
  end if;
  perform private.lock_survey_context_v1(p_actor_id,v_classroom.id,p_survey_id,false,true);
  return jsonb_build_object('success',true);
exception when lock_not_available or deadlock_detected then raise exception using errcode='PT409', message='survey_operation_busy';
end;
$function$;

create function public.respond_to_survey_for_member_v1(p_actor_id uuid,p_survey_id uuid,p_classroom_id uuid,p_expected_questions jsonb,p_responses jsonb)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout='1s' set statement_timeout='8s' as $function$
declare
  v_classroom public.classrooms; v_survey public.surveys; v_questions jsonb; v_question public.survey_questions;
  v_answer jsonb; v_text text; v_option numeric; v_answered boolean; v_now timestamptz:=clock_timestamp(); v_length integer;
begin
  v_classroom:=private.lock_survey_context_v1(p_actor_id,p_classroom_id,p_survey_id,true,true);
  v_now:=clock_timestamp();
  select * into strict v_survey from public.surveys where id=p_survey_id;
  if v_survey.status<>'active' or v_survey.opens_at>v_now then raise exception using errcode='PT400', message='survey_not_open'; end if;
  select exists(select 1 from public.survey_responses where survey_id=p_survey_id and student_id=p_actor_id) into v_answered;
  if v_answered and not v_survey.dynamic_responses then raise exception using errcode='PT400', message='survey_already_answered'; end if;
  select coalesce(jsonb_agg(to_jsonb(question) order by position,id),'[]'::jsonb) into v_questions from public.survey_questions question where survey_id=p_survey_id;
  if p_expected_questions is null or octet_length(p_expected_questions::text)>8388608 or v_questions is distinct from p_expected_questions then raise exception using errcode='PT409', message='survey_questions_changed'; end if;
  if jsonb_array_length(v_questions)=0 or jsonb_array_length(v_questions)>10000 or p_responses is null or jsonb_typeof(p_responses)<>'object'
    or (select count(*) from jsonb_object_keys(p_responses))<>jsonb_array_length(v_questions)
    or octet_length(p_responses::text)>8388608 then raise exception using errcode='PT400', message='survey_invalid_responses'; end if;
  for v_question in select * from public.survey_questions where survey_id=p_survey_id order by position,id loop
    v_answer:=p_responses->v_question.id::text;
    if v_answer is null or jsonb_typeof(v_answer)<>'object' or v_answer->>'question_type' is distinct from v_question.question_type then
      raise exception using errcode='PT400', message='survey_invalid_responses';
    end if;
    v_text:=null; v_option:=null;
    if v_question.question_type='multiple_choice' then
      if jsonb_typeof(v_answer->'selected_option') is distinct from 'number'
        or (select count(*) from jsonb_object_keys(v_answer))<>2 then raise exception using errcode='PT400', message='survey_invalid_option'; end if;
      v_option:=(v_answer->>'selected_option')::numeric;
      if v_option<>trunc(v_option) or v_option<0 or v_option>=jsonb_array_length(v_question.options) then raise exception using errcode='PT400', message='survey_invalid_option'; end if;
    else
      if jsonb_typeof(v_answer->'response_text') is distinct from 'string' or (select count(*) from jsonb_object_keys(v_answer))<>2 then
        raise exception using errcode='PT400', message='survey_invalid_text';
      end if;
      v_text:=v_answer->>'response_text';
      -- JS string.length is UTF-16 code units; PostgreSQL length counts codepoints.
      v_length:=private.material_owner_write_utf16_length_v1(v_text);
      if length(private.material_owner_write_title_v1(v_text))=0 or v_length>v_question.response_max_chars
        or private.material_owner_write_title_v1(v_text) is distinct from v_text
        or (v_question.question_type='link' and v_text !~ '^https?://[^[:space:]]+$') then
        raise exception using errcode='PT400', message='survey_invalid_text';
      end if;
    end if;
    insert into public.survey_responses(survey_id,question_id,student_id,selected_option,response_text,submitted_at,updated_at)
      values(p_survey_id,v_question.id,p_actor_id,v_option::integer,v_text,v_now,v_now)
      on conflict(question_id,student_id) do update set selected_option=excluded.selected_option,response_text=excluded.response_text,updated_at=excluded.updated_at
      where public.survey_responses.survey_id=p_survey_id and v_survey.dynamic_responses;
    if not found then raise exception using errcode='PT400', message='survey_already_answered'; end if;
  end loop;
  perform private.lock_survey_context_v1(p_actor_id,v_classroom.id,p_survey_id,true,true);
  if (select coalesce(jsonb_agg(to_jsonb(question) order by position,id),'[]'::jsonb) from public.survey_questions question where survey_id=p_survey_id) is distinct from v_questions
    or (select count(*) from public.survey_responses where survey_id=p_survey_id and student_id=p_actor_id)<>jsonb_array_length(v_questions)
    or exists(select 1 from public.survey_responses response join public.survey_questions question on question.id=response.question_id
      where response.survey_id=p_survey_id and response.student_id=p_actor_id and (
        question.survey_id<>p_survey_id or case when question.question_type='multiple_choice'
          then to_jsonb(response.selected_option) is distinct from p_responses->question.id::text->'selected_option'
          else to_jsonb(response.response_text) is distinct from p_responses->question.id::text->'response_text' end)) then
    raise exception using errcode='PT409', message='survey_response_changed';
  end if;
  return jsonb_build_object('success',true,'updated',v_answered);
end;
$function$;

-- New public functions do not inherit PostgreSQL's public EXECUTE default.
revoke all on function public.get_survey_for_owner_v1(uuid,uuid), public.get_survey_for_member_v1(uuid,uuid),
  public.get_surveys_for_owner_v1(uuid,uuid), public.get_surveys_for_member_v1(uuid,uuid),
  public.get_survey_results_for_owner_v1(uuid,uuid), public.get_survey_results_for_member_v1(uuid,uuid),
  public.update_survey_for_owner_v1(uuid,uuid,jsonb), public.delete_survey_for_owner_v1(uuid,uuid),
  public.create_survey_question_for_owner_v1(uuid,uuid,jsonb), public.update_survey_question_for_owner_v1(uuid,uuid,uuid,jsonb,jsonb),
  public.delete_survey_question_for_owner_v1(uuid,uuid,uuid), public.respond_to_survey_for_member_v1(uuid,uuid,uuid,jsonb,jsonb)
  from public,anon,authenticated;
grant execute on function public.get_survey_for_owner_v1(uuid,uuid), public.get_survey_for_member_v1(uuid,uuid),
  public.get_surveys_for_owner_v1(uuid,uuid), public.get_surveys_for_member_v1(uuid,uuid),
  public.get_survey_results_for_owner_v1(uuid,uuid), public.get_survey_results_for_member_v1(uuid,uuid),
  public.update_survey_for_owner_v1(uuid,uuid,jsonb), public.delete_survey_for_owner_v1(uuid,uuid),
  public.create_survey_question_for_owner_v1(uuid,uuid,jsonb), public.update_survey_question_for_owner_v1(uuid,uuid,uuid,jsonb,jsonb),
  public.delete_survey_question_for_owner_v1(uuid,uuid,uuid), public.respond_to_survey_for_member_v1(uuid,uuid,uuid,jsonb,jsonb)
  to service_role;
commit;
