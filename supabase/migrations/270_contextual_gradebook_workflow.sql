-- Dormant service-only contextual Gradebook/own-member Grades boundary.
-- No rollout switch, grading algorithm, legacy writer ACL or schema changes.
begin;

create function private.gradebook_deadline_v1(p_deadline timestamptz)
returns timestamptz language plpgsql security invoker set search_path = '' as $function$
begin
  if p_deadline is null or not isfinite(p_deadline)
    or p_deadline > clock_timestamp()+interval '30 seconds' then
    raise exception using errcode='PT400', message='gradebook_invalid_deadline';
  end if;
  if p_deadline <= clock_timestamp() then raise exception using errcode='PT503', message='gradebook_deadline'; end if;
  return least(p_deadline,clock_timestamp()+interval '8 seconds');
end;
$function$;
revoke all on function private.gradebook_deadline_v1(timestamptz) from public,anon,authenticated,service_role;

create function private.lock_gradebook_context_v1(
  p_actor_id uuid,p_classroom_id uuid,p_member boolean,p_mutating boolean
) returns public.classrooms language plpgsql security invoker set search_path = '' as $function$
declare
  v_classroom public.classrooms; v_subject uuid; v_subjects uuid[]; v_message text;
begin
  if p_actor_id is null or p_classroom_id is null or p_member is null or p_mutating is null then
    raise exception using errcode='PT400', message='gradebook_invalid_context';
  end if;
  if coalesce(public.is_classroom_archive_maintenance_mode('restore'),false)
    or coalesce(public.is_classroom_archive_maintenance_mode('compaction'),false)
    or coalesce(current_setting('pika.identity_mapping',true),'off')='on'
    or coalesce(current_setting('pika.classroom_purge_finalize',true),'off')='on'
    or coalesce(current_setting('pika.course_blueprint_purge_finalize',true),'off')='on'
    or coalesce(current_setting('pika.student_purge_finalize',true),'off')='on' then
    raise exception using errcode='PT403', message='gradebook_fenced';
  end if;
  -- Reuse164's EXCLUSIVE transaction advisory protocol, including purge locks.
  perform private.try_lock_classroom_membership_change(p_classroom_id);
  perform public.guard_classroom_purge_lifecycle(p_classroom_id);
  select * into v_classroom from public.classrooms where id=p_classroom_id for update nowait;
  if not found then raise exception using errcode='PT404', message='gradebook_classroom_not_found'; end if;
  if (p_member and v_classroom.teacher_id=p_actor_id)
    or (not p_member and v_classroom.teacher_id is distinct from p_actor_id)
    or ((p_member or p_mutating) and v_classroom.archived_at is not null) then
    raise exception using errcode='PT403', message='gradebook_forbidden';
  end if;
  perform 1 from public.users where id=p_actor_id for key share nowait;
  if not found then raise exception using errcode='PT403', message='gradebook_forbidden'; end if;
  perform 1 from public.classroom_archive_revisions where classroom_id=p_classroom_id for update nowait;
  if not found then raise exception using errcode='PT503', message='gradebook_revision_unavailable'; end if;
  if exists(select 1 from public.student_purge_operations operation
    join private.student_provider_cleanup_bindings binding on binding.operation_id=operation.id
    where operation.classroom_id=p_classroom_id and operation.status<>'completed') then
    raise exception using errcode='PT403', message='gradebook_provider_cleanup_fenced';
  end if;
  if p_member then v_subjects:=array[p_actor_id];
  else
    -- Broader mutations include removed affected subjects BEFORE cascades.
    -- No enrollment join may hide an existing subject fence.
    -- Bound each distinct-subject input before UNION aggregation. A capped
    -- input with1001 distinct subjects necessarily makes the union overflow.
    with enrolled as materialized (
      select student_id from public.classroom_enrollments where classroom_id=p_classroom_id and student_id<>v_classroom.teacher_id
      order by student_id limit 1001
    ), item_subjects as materialized (
      select distinct student_id from public.gradebook_item_scores where p_mutating and classroom_id=p_classroom_id order by student_id limit 1001
    ), override_subjects as materialized (
      select distinct student_id from public.gradebook_score_overrides where p_mutating and classroom_id=p_classroom_id order by student_id limit 1001
    ), doc_subjects as materialized (
      select distinct d.student_id from public.assignment_docs d join public.assignments a on a.id=d.assignment_id
      where p_mutating and a.classroom_id=p_classroom_id order by d.student_id limit 1001
    ), response_subjects as materialized (
      select distinct r.student_id from public.test_responses r join public.tests t on t.id=r.test_id
      where p_mutating and t.classroom_id=p_classroom_id order by r.student_id limit 1001
    ), attempt_subjects as materialized (
      select distinct a.student_id from public.test_attempts a join public.tests t on t.id=a.test_id
      where p_mutating and t.classroom_id=p_classroom_id order by a.student_id limit 1001
    ), affected as materialized (
      select student_id from enrolled union select student_id from item_subjects
      union select student_id from override_subjects union select student_id from doc_subjects
      union select student_id from response_subjects union select student_id from attempt_subjects
      order by student_id limit 1001
    ) select coalesce(array_agg(student_id order by student_id),'{}'::uuid[]) into v_subjects from affected;
    if cardinality(v_subjects)>1000 then raise exception using errcode='PT503', message='gradebook_subject_limit'; end if;
  end if;
  foreach v_subject in array v_subjects loop
    perform private.try_lock_classroom_membership_change(p_classroom_id,v_subject);
    perform 1 from public.classroom_enrollments where classroom_id=p_classroom_id and student_id=v_subject for share nowait;
    if p_member and not found then raise exception using errcode='PT403', message='gradebook_not_enrolled'; end if;
    if exists(select 1 from public.student_purge_fences where classroom_id=p_classroom_id and student_id=v_subject) then
      raise exception using errcode='PT409', message='gradebook_subject_fenced';
    end if;
  end loop;
  return v_classroom;
exception when sqlstate '40001' or sqlstate '40P01' or sqlstate '55P03' then
  get stacked diagnostics v_message=message_text;
  if sqlstate='40001' and v_message not in ('classroom_operation_busy','student_operation_busy') then raise; end if;
  raise exception using errcode='PT409', message='gradebook_operation_busy';
end;
$function$;
revoke all on function private.lock_gradebook_context_v1(uuid,uuid,boolean,boolean) from public,anon,authenticated,service_role;

create function private.gradebook_classroom_json_v1(p_classroom public.classrooms)
returns jsonb language sql immutable security invoker set search_path = '' as $function$
  select jsonb_build_object('id',(p_classroom).id,'teacher_id',(p_classroom).teacher_id,'archived_at',(p_classroom).archived_at)
$function$;
revoke all on function private.gradebook_classroom_json_v1(public.classrooms) from public,anon,authenticated,service_role;

create function private.gradebook_source_v1(p_actor_id uuid,p_classroom public.classrooms,p_view text)
returns jsonb language plpgsql security invoker set search_path = '' as $function$
declare
  v_member boolean:=p_view<>'owner'; v_visibility jsonb; v_source jsonb;
  v_invalid boolean; v_classwork boolean; v_tests boolean;
begin
  select jsonb_build_object(
    'classwork',case when jsonb_typeof(p_classroom.feature_visibility->'classwork')='boolean' then p_classroom.feature_visibility->'classwork' else 'true'::jsonb end,
    'tests',case when jsonb_typeof(p_classroom.feature_visibility->'tests')='boolean' then p_classroom.feature_visibility->'tests' else 'true'::jsonb end,
    'student_grades',case when jsonb_typeof(p_classroom.feature_visibility->'student_grades')='boolean' then p_classroom.feature_visibility->'student_grades' else 'false'::jsonb end,
    'gradebook_compact_zero_weight_assessments',case when jsonb_typeof(p_classroom.feature_visibility->'gradebook_compact_zero_weight_assessments')='boolean' then p_classroom.feature_visibility->'gradebook_compact_zero_weight_assessments' else 'true'::jsonb end
  ) into v_visibility;
  v_classwork:=(v_visibility->>'classwork')::boolean; v_tests:=(v_visibility->>'tests')::boolean;
  if (p_view='grades' and (not (v_visibility->>'student_grades')::boolean or not (v_classwork or v_tests)))
    or (p_view='items' and not v_classwork) then raise exception using errcode='PT403', message='gradebook_hidden'; end if;
  -- ONE source statement snapshot; cap+1 MATERIALIZED explicit row sets.
  with roster as materialized (
    select e.student_id,u.email from public.classroom_enrollments e join public.users u on u.id=e.student_id where not v_member and e.classroom_id=p_classroom.id and e.student_id<>p_classroom.teacher_id order by student_id limit 1001
  ), profiles as materialized (
    select p.user_id,p.student_number,p.first_name,p.last_name from public.student_profiles p join roster r on r.student_id=p.user_id order by user_id limit 1001
  ), assignments as materialized (
    select a.id,a.classroom_id,a.title,a.due_at,a.position,a.is_draft,a.points_possible,a.include_in_final,a.gradebook_weight,a.gradebook_category_id,a.gradebook_maximum_override,a.gradebook_score_scale
      from public.assignments a where a.classroom_id=p_classroom.id and (not v_member or (p_view='grades' and v_classwork and not a.is_draft
        and exists(select 1 from public.assignment_docs d where d.assignment_id=a.id and d.student_id=p_actor_id and d.returned_at is not null))) order by position,id limit 1001
  ), assignment_docs as materialized (
    select d.assignment_id,d.student_id,d.score_completion,d.score_thinking,d.score_workflow,d.is_submitted,d.submitted_at,d.returned_at,d.teacher_cleared_at,d.graded_at
      from public.assignment_docs d join assignments a on a.id=d.assignment_id
      where (not v_member and exists(select 1 from roster r where r.student_id=d.student_id)) or (v_member and d.student_id=p_actor_id and d.returned_at is not null) order by assignment_id,student_id limit 100001
  ), tests as materialized (
    select t.id,t.classroom_id,t.title,t.position,t.status,t.include_in_final,t.gradebook_weight,t.gradebook_category_id,t.gradebook_maximum_override,t.gradebook_score_scale
      from public.tests t where t.classroom_id=p_classroom.id and (not v_member or (p_view='grades' and v_tests and t.status<>'draft'
        and exists(select 1 from public.test_attempts a where a.test_id=t.id and a.student_id=p_actor_id and a.returned_at is not null))) order by position,id limit 1001
  ), test_questions as materialized (
    select q.id,q.test_id,q.points from public.test_questions q join tests t on t.id=q.test_id order by test_id,id limit 50001
  ), test_responses as materialized (
    select r.test_id,r.question_id,r.student_id,r.score from public.test_responses r
      join test_questions q on q.id=r.question_id and q.test_id=r.test_id
      where (not v_member and exists(select 1 from roster s where s.student_id=r.student_id)) or (v_member and r.student_id=p_actor_id) order by test_id,question_id,student_id limit 500001
  ), test_attempts as materialized (
    select a.test_id,a.student_id,a.is_submitted,a.submitted_at,a.returned_at from public.test_attempts a join tests t on t.id=a.test_id
      where (not v_member and exists(select 1 from roster r where r.student_id=a.student_id)) or (v_member and a.student_id=p_actor_id and a.returned_at is not null) order by test_id,student_id limit 100001
  ), items as materialized (
    select i.id,i.classroom_id,i.title,i.points_possible,i.gradebook_weight,i.gradebook_category_id,i.include_in_final,i.created_at,i.gradebook_maximum_override,i.gradebook_score_scale
      from public.gradebook_items i where i.classroom_id=p_classroom.id and (not v_member or (v_classwork and exists(select 1 from public.gradebook_item_scores s
        where s.item_id=i.id and s.classroom_id=i.classroom_id and s.student_id=p_actor_id and s.earned is not null))) order by created_at,id limit 1001
  ), item_scores as materialized (
    select s.item_id,s.classroom_id,s.student_id,s.earned,s.returned_at,s.updated_at from public.gradebook_item_scores s
      join items i on i.id=s.item_id and i.classroom_id=s.classroom_id
      where (not v_member and exists(select 1 from roster r where r.student_id=s.student_id)) or (v_member and s.student_id=p_actor_id and s.earned is not null) order by item_id,student_id limit 100001
  ), score_overrides as materialized (
    select o.classroom_id,o.student_id,o.assessment_type,o.assessment_id,o.earned from public.gradebook_score_overrides o
      where o.classroom_id=p_classroom.id and ((not v_member and exists(select 1 from roster r where r.student_id=o.student_id))
        or (v_member and p_view='grades' and o.student_id=p_actor_id and (
          (o.assessment_type='assignment' and exists(select 1 from assignments a where a.id=o.assessment_id))
          or (o.assessment_type='test' and exists(select 1 from tests t where t.id=o.assessment_id))))) order by student_id,assessment_type,assessment_id limit 201001
  ), categories as materialized (
    select c.id,c.classroom_id,c.name,c.percentage,c.default_assessment_weight,c.position,c.is_default
      from public.gradebook_categories c where c.classroom_id=p_classroom.id and (p_view<>'items'
        or exists(select 1 from items i where i.gradebook_category_id=c.id)) order by position,id limit 21
  ), projected_rows as materialized (
    select to_jsonb(r) payload from roster r
    union all select to_jsonb(r) payload from profiles r
    union all select to_jsonb(r) payload from assignments r
    union all select to_jsonb(r) payload from assignment_docs r
    union all select to_jsonb(r) payload from tests r
    union all select to_jsonb(r) payload from test_questions r
    union all select to_jsonb(r) payload from test_responses r
    union all select to_jsonb(r) payload from test_attempts r
    union all select to_jsonb(r) payload from items r
    union all select to_jsonb(r) payload from item_scores r
    union all select to_jsonb(r) payload from score_overrides r
    union all select to_jsonb(r) payload from categories r
  ), source_stats as materialized (
    select coalesce(sum(octet_length(payload::text)),0) bytes,
      coalesce(bool_or(exists(select 1 from jsonb_each(payload) field
        where jsonb_typeof(field.value)='string' and octet_length(field.value#>>'{}')>16384)),false) string_overflow
    from projected_rows
  ), source_guard as materialized (
    select bytes>16777216 or string_overflow
      or (select count(*) from roster)>1000
      or (select count(*) from profiles)>1000
      or (select count(*) from assignments)>1000
      or (select count(*) from assignment_docs)>100000
      or (select count(*) from tests)>1000
      or (select count(*) from test_questions)>50000
      or (select count(*) from test_responses)>500000
      or (select count(*) from test_attempts)>100000
      or (select count(*) from items)>1000
      or (select count(*) from item_scores)>100000
      or (select count(*) from score_overrides)>201000
      or (select count(*) from categories)>20
      or ((select count(*) from assignments)+(select count(*) from tests)+(select count(*) from items))>2000
      or (not v_member and (select count(*) from roster)*
        ((select count(*) from assignments)+(select count(*) from tests)+(select count(*) from items))>200000)
      or exists(select 1 from test_questions group by test_id having count(*)>500) invalid
    from source_stats
  )
  select invalid,case when not invalid then jsonb_build_object(
    'assignments',(select coalesce(jsonb_agg(to_jsonb(r) order by position,id),'[]'::jsonb) from assignments r),
    'assignment_docs',(select coalesce(jsonb_agg(to_jsonb(r) order by assignment_id,student_id),'[]'::jsonb) from assignment_docs r),
    'tests',(select coalesce(jsonb_agg(to_jsonb(r) order by position,id),'[]'::jsonb) from tests r),
    'test_questions',(select coalesce(jsonb_agg(to_jsonb(r) order by test_id,id),'[]'::jsonb) from test_questions r),
    'test_responses',(select coalesce(jsonb_agg(to_jsonb(r) order by test_id,question_id,student_id),'[]'::jsonb) from test_responses r),
    'test_attempts',(select coalesce(jsonb_agg(to_jsonb(r) order by test_id,student_id),'[]'::jsonb) from test_attempts r),
    'items',(select coalesce(jsonb_agg(to_jsonb(r) order by created_at,id),'[]'::jsonb) from items r),
    'item_scores',(select coalesce(jsonb_agg(to_jsonb(r) order by item_id,student_id),'[]'::jsonb) from item_scores r),
    'score_overrides',(select coalesce(jsonb_agg(to_jsonb(r) order by student_id,assessment_type,assessment_id),'[]'::jsonb) from score_overrides r),
    'categories',(select coalesce(jsonb_agg(to_jsonb(r) order by position,id),'[]'::jsonb) from categories r)
  ) || case when v_member then jsonb_build_object('student_id',p_actor_id,'visibility',v_visibility)
    else jsonb_build_object(
      'roster',(select coalesce(jsonb_agg(to_jsonb(r) order by student_id),'[]'::jsonb) from roster r),
      'profiles',(select coalesce(jsonb_agg(to_jsonb(r) order by user_id),'[]'::jsonb) from profiles r)) end end
  into v_invalid,v_source from source_guard;
  if v_invalid or v_source is null or octet_length(v_source::text)>20971520 then
    raise exception using errcode='PT503', message='gradebook_source_limit';
  end if;
  return v_source;
end;
$function$;
revoke all on function private.gradebook_source_v1(uuid,public.classrooms,text) from public,anon,authenticated,service_role;

create function private.validate_gradebook_payload_v1(p_action text,p_payload jsonb)
returns void language plpgsql security invoker set search_path = '' as $function$
declare v_keys text[]; v_key text; v_value jsonb; v_category jsonb; v_ordinal bigint;
begin
  if p_action is null or p_payload is null or jsonb_typeof(p_payload)<>'object'
    or octet_length(p_payload::text)>65536 then
    raise exception using errcode='PT400', message='gradebook_invalid_payload';
  end if;
  v_keys:=case p_action
    when 'assessment_weight' then array['assessment_type','assessment_id','gradebook_weight']::text[]
    when 'assessment_details' then array['assessment_type','assessment_id','gradebook_weight','gradebook_category_id']::text[]
    when 'categories_replace' then array['categories']::text[]
    when 'override_save' then array['student_id','assessment_type','assessment_id','earned']::text[]
    when 'override_delete_one' then array['student_id','assessment_type','assessment_id']::text[]
    when 'override_delete_all' then array[]::text[]
    when 'item_create' then array['item_id','title','points_possible','gradebook_category_id','gradebook_weight','include_in_final']::text[]
    when 'item_update' then array['item_id','title','points_possible','gradebook_category_id','gradebook_weight','include_in_final']::text[]
    when 'item_weight' then array['item_id','gradebook_weight']::text[]
    when 'item_delete' then array['item_id']::text[]
    when 'item_return_marks' then array['item_id']::text[]
    when 'item_score' then array['item_id','student_id','earned']::text[]
    when 'maximum' then array['assessment_type','assessment_id','maximum','mode','expected_maximum','expected_scale']::text[]
    else null end;
  if v_keys is null or not (p_payload ?& v_keys) or p_payload-v_keys<>'{}'::jsonb then
    raise exception using errcode='PT400', message='gradebook_invalid_payload';
  end if;
  foreach v_key in array v_keys loop
    v_value:=p_payload->v_key;
    if v_key in ('item_id','student_id','assessment_id','gradebook_category_id') then
      if not (v_key='gradebook_category_id' and v_value='null'::jsonb) and
        (jsonb_typeof(v_value)<>'string' or (v_value#>>'{}')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
        raise exception using errcode='PT400', message='gradebook_invalid_id';
      end if;
    elsif v_key in ('gradebook_weight','earned','points_possible','maximum','expected_maximum','expected_scale') then
      if (v_key='earned' and p_action='item_score' and v_value='null'::jsonb)
        or (v_key='maximum' and v_value='null'::jsonb) then continue; end if;
      if jsonb_typeof(v_value)<>'number' then raise exception using errcode='PT400', message='gradebook_invalid_number'; end if;
      if (v_key='gradebook_weight' and ((v_value#>>'{}')::numeric not between 0 and 999 or (v_value#>>'{}')::numeric<>trunc((v_value#>>'{}')::numeric)))
        or (v_key in ('earned','points_possible','maximum') and ((v_value#>>'{}')::numeric not between 0 and 999999.9
          or (v_value#>>'{}')::numeric<>round((v_value#>>'{}')::numeric,1)))
        or (v_key in ('points_possible','maximum','expected_scale') and (v_value#>>'{}')::numeric<=0)
        or (v_key='expected_maximum' and (v_value#>>'{}')::numeric<0) then
        raise exception using errcode='PT400', message='gradebook_invalid_number';
      end if;
    elsif v_key='include_in_final' then
      if jsonb_typeof(v_value)<>'boolean' then raise exception using errcode='PT400', message='gradebook_invalid_boolean'; end if;
    elsif v_key='title' then
      if jsonb_typeof(v_value)<>'string' or char_length(btrim(v_value#>>'{}')) not between 1 and 200 then
        raise exception using errcode='PT400', message='gradebook_invalid_title';
      end if;
    elsif v_key='assessment_type' then
      if jsonb_typeof(v_value)<>'string' or (v_value#>>'{}') not in ('assignment','test',
        case when p_action in ('override_save','override_delete_one') then 'final' when p_action='maximum' then 'item' else 'test' end) then
        raise exception using errcode='PT400', message='gradebook_invalid_type';
      end if;
    elsif v_key='mode' then
      if jsonb_typeof(v_value)<>'string' or (v_value#>>'{}') not in ('keep_marks','preserve_percentages','reset') then
        raise exception using errcode='PT400', message='gradebook_invalid_mode';
      end if;
    end if;
  end loop;
  if p_action='maximum' and ((p_payload->>'mode'='reset') is distinct from (p_payload->'maximum'='null'::jsonb)) then
    raise exception using errcode='PT400', message='gradebook_invalid_maximum';
  end if;
  if p_action='categories_replace' then
    if jsonb_typeof(p_payload->'categories')<>'array' then raise exception using errcode='PT400', message='gradebook_invalid_categories'; end if;
    if jsonb_array_length(p_payload->'categories') not between 1 and 20 then raise exception using errcode='PT400', message='gradebook_invalid_categories'; end if;
    for v_category,v_ordinal in select value,ordinality from jsonb_array_elements(p_payload->'categories') with ordinality loop
      if jsonb_typeof(v_category)<>'object' or not (v_category ?& array['id','name','percentage','default_assessment_weight','position','is_default'])
        or v_category-array['id','name','percentage','default_assessment_weight','position','is_default']<>'{}'::jsonb
        or jsonb_typeof(v_category->'id')<>'string' or (v_category->>'id')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or jsonb_typeof(v_category->'name')<>'string' or char_length(btrim(v_category->>'name')) not between 1 and 80
        or starts_with(lower(btrim(v_category->>'name')),'__pika_replacing__')
        or jsonb_typeof(v_category->'percentage')<>'number'
        or jsonb_typeof(v_category->'default_assessment_weight')<>'number'
        or jsonb_typeof(v_category->'position')<>'number'
        or jsonb_typeof(v_category->'is_default')<>'boolean' then
        raise exception using errcode='PT400', message='gradebook_invalid_category';
      end if;
      if (v_category->>'percentage')::numeric not between 0 and 100
        or (v_category->>'percentage')::numeric<>round((v_category->>'percentage')::numeric,2)
        or (v_category->>'default_assessment_weight')::numeric not between 1 and 999
        or (v_category->>'default_assessment_weight')::numeric<>trunc((v_category->>'default_assessment_weight')::numeric)
        or (v_category->>'position')::numeric<>v_ordinal-1 then
        raise exception using errcode='PT400', message='gradebook_invalid_category';
      end if;
    end loop;
    if (select count(*) from jsonb_array_elements(p_payload->'categories') c where (c->>'is_default')::boolean)<>1
      or (select sum((c->>'percentage')::numeric) from jsonb_array_elements(p_payload->'categories') c)<>100
      or exists(select 1 from jsonb_array_elements(p_payload->'categories') c group by c->>'id' having count(*)>1)
      or exists(select 1 from jsonb_array_elements(p_payload->'categories') c group by lower(btrim(c->>'name')) having count(*)>1) then
      raise exception using errcode='PT400', message='gradebook_invalid_categories';
    end if;
  end if;
end;
$function$;
revoke all on function private.validate_gradebook_payload_v1(text,jsonb) from public,anon,authenticated,service_role;

create function public.get_gradebook_for_owner_v1(
  p_actor_id uuid,p_classroom_id uuid,p_selected_student_id uuid,p_deadline timestamptz
) returns jsonb language plpgsql security definer set search_path = ''
set lock_timeout='1s' set statement_timeout='8s' as $function$
declare v_classroom public.classrooms; v_source jsonb; v_result jsonb; v_deadline timestamptz;
begin
  v_deadline:=private.gradebook_deadline_v1(p_deadline);
  v_classroom:=private.lock_gradebook_context_v1(p_actor_id,p_classroom_id,false,false);
  if p_selected_student_id is not null and (p_selected_student_id=v_classroom.teacher_id or not exists(
    select 1 from public.classroom_enrollments where classroom_id=p_classroom_id and student_id=p_selected_student_id)) then
    raise exception using errcode='PT404', message='gradebook_student_not_found';
  end if;
  if clock_timestamp()>=v_deadline then raise exception using errcode='PT503', message='gradebook_deadline'; end if;
  v_source:=private.gradebook_source_v1(p_actor_id,v_classroom,'owner');
  v_result:=jsonb_build_object('actor_id',p_actor_id,'classroom',private.gradebook_classroom_json_v1(v_classroom),
    'operation','owner-read','selected_student_id',p_selected_student_id,'source',v_source);
  if clock_timestamp()>=v_deadline or octet_length(v_result::text)>20971520 then
    raise exception using errcode='PT503', message='gradebook_completion_limit';
  end if;
  return v_result;
exception when lock_not_available or deadlock_detected then
  raise exception using errcode='PT409', message='gradebook_operation_busy';
end;
$function$;

create function public.get_gradebook_for_member_v1(
  p_actor_id uuid,p_classroom_id uuid,p_view text,p_deadline timestamptz
) returns jsonb language plpgsql security definer set search_path = ''
set lock_timeout='1s' set statement_timeout='8s' as $function$
declare v_classroom public.classrooms; v_source jsonb; v_result jsonb; v_deadline timestamptz;
begin
  v_deadline:=private.gradebook_deadline_v1(p_deadline);
  if p_view is null or p_view not in ('grades','items') then raise exception using errcode='PT400', message='gradebook_invalid_view'; end if;
  v_classroom:=private.lock_gradebook_context_v1(p_actor_id,p_classroom_id,true,false);
  if clock_timestamp()>=v_deadline then raise exception using errcode='PT503', message='gradebook_deadline'; end if;
  v_source:=private.gradebook_source_v1(p_actor_id,v_classroom,p_view);
  v_result:=jsonb_build_object('actor_id',p_actor_id,'classroom',private.gradebook_classroom_json_v1(v_classroom),
    'operation','member-'||p_view,'source',v_source);
  if clock_timestamp()>=v_deadline or octet_length(v_result::text)>20971520 then
    raise exception using errcode='PT503', message='gradebook_completion_limit';
  end if;
  return v_result;
exception when lock_not_available or deadlock_detected then
  raise exception using errcode='PT409', message='gradebook_operation_busy';
end;
$function$;

create function public.mutate_gradebook_for_owner_v1(
  p_actor_id uuid,p_classroom_id uuid,p_action text,p_payload jsonb,p_deadline timestamptz
) returns jsonb language plpgsql security definer set search_path = ''
set lock_timeout='1s' set statement_timeout='8s' as $function$
declare
  v_classroom public.classrooms; v_deadline timestamptz; v_result jsonb; v_inner jsonb;
  v_type text; v_id uuid; v_student uuid; v_category uuid; v_found uuid; v_archived timestamptz;
  v_item jsonb; v_message text; v_target jsonb;
begin
  v_deadline:=private.gradebook_deadline_v1(p_deadline);
  perform private.validate_gradebook_payload_v1(p_action,p_payload);
  v_classroom:=private.lock_gradebook_context_v1(p_actor_id,p_classroom_id,false,true);
  if p_payload ? 'student_id' then
    v_student:=(p_payload->>'student_id')::uuid;
    if v_student=v_classroom.teacher_id then raise exception using errcode='PT400', message='gradebook_invalid_student'; end if;
    perform 1 from public.classroom_enrollments where classroom_id=p_classroom_id and student_id=v_student for share nowait;
    if not found then raise exception using errcode='PT404', message='gradebook_student_not_found'; end if;
  end if;
  if p_payload ? 'assessment_id' then
    v_id:=(p_payload->>'assessment_id')::uuid; v_type:=p_payload->>'assessment_type';
  elsif p_payload ? 'item_id' then v_id:=(p_payload->>'item_id')::uuid; v_type:='item'; end if;
  if v_type='assignment' then
    select id,blueprint_archived_at into v_found,v_archived from public.assignments where id=v_id and classroom_id=p_classroom_id for update nowait;
  elsif v_type='test' then
    select id,blueprint_archived_at into v_found,v_archived from public.tests where id=v_id and classroom_id=p_classroom_id for update nowait;
  elsif v_type='item' then
    select id into v_found from public.gradebook_items where id=v_id and classroom_id=p_classroom_id for update nowait;
  elsif v_type='final' then
    if v_id<>p_classroom_id then raise exception using errcode='PT400', message='gradebook_invalid_final'; end if;
    v_found:=p_classroom_id;
  end if;
  if v_type is not null and v_found is null and p_action<>'item_create' then
    raise exception using errcode='PT404', message='gradebook_assessment_not_found';
  end if;
  if v_archived is not null then raise exception using errcode='PT403', message='gradebook_assessment_read_only'; end if;
  if p_payload ? 'gradebook_category_id' and p_payload->'gradebook_category_id'<>'null'::jsonb then
    v_category:=(p_payload->>'gradebook_category_id')::uuid;
    perform 1 from public.gradebook_categories where id=v_category and classroom_id=p_classroom_id for key share nowait;
    if not found then raise exception using errcode='PT400', message='gradebook_category_not_found'; end if;
  end if;
  if p_action='categories_replace' then
    perform 1 from public.gradebook_categories where classroom_id=p_classroom_id order by id for update nowait;
    if exists(select 1 from jsonb_array_elements(p_payload->'categories') supplied
      join public.gradebook_categories c on c.id=(supplied->>'id')::uuid where c.classroom_id<>p_classroom_id) then
      raise exception using errcode='PT400', message='gradebook_foreign_category';
    end if;
  end if;
  if clock_timestamp()>=v_deadline then raise exception using errcode='PT503', message='gradebook_deadline'; end if;
  if p_action in ('assessment_weight','assessment_details') then
    if v_type='assignment' then
      update public.assignments set gradebook_weight=(p_payload->>'gradebook_weight')::integer,
        gradebook_category_id=case when p_action='assessment_details' then v_category else gradebook_category_id end
        where id=v_id and classroom_id=p_classroom_id;
    else
      update public.tests set gradebook_weight=(p_payload->>'gradebook_weight')::integer,
        gradebook_category_id=case when p_action='assessment_details' then v_category else gradebook_category_id end
        where id=v_id and classroom_id=p_classroom_id;
    end if;
    if not found then raise exception using errcode='PT409', message='gradebook_parent_changed'; end if;
    v_result:=jsonb_build_object('assessment',jsonb_build_object('assessment_id',v_id,'assessment_type',v_type,
      'weight',(p_payload->>'gradebook_weight')::integer) ||
      case when p_action='assessment_details' then jsonb_build_object('category_id',v_category) else '{}'::jsonb end);
  elsif p_action='categories_replace' then
    select jsonb_build_object('categories',coalesce(jsonb_agg(jsonb_build_object(
      'id',c.id,'classroom_id',c.classroom_id,'name',c.name,'percentage',c.percentage,
      'default_assessment_weight',c.default_assessment_weight,'position',c.position,'is_default',c.is_default)
      order by c.position,c.id),'[]'::jsonb)) into v_result
      from public.replace_gradebook_categories(p_classroom_id,p_payload->'categories') c;
  elsif p_action='override_save' then
    if v_type='final' then
      insert into public.gradebook_score_overrides(classroom_id,student_id,assessment_type,assessment_id,earned,created_by)
        values(p_classroom_id,v_student,'final',p_classroom_id,(p_payload->>'earned')::numeric,p_actor_id)
        on conflict(classroom_id,student_id,assessment_type,assessment_id) do update
        set earned=excluded.earned,created_by=excluded.created_by;
      v_result:=jsonb_build_object('saved',true);
    else
      v_result:=public.save_gradebook_effective_mark(p_actor_id,p_classroom_id,v_type,v_id,v_student,(p_payload->>'earned')::numeric);
    end if;
  elsif p_action='override_delete_one' then
    delete from public.gradebook_score_overrides where classroom_id=p_classroom_id and student_id=v_student
      and assessment_type=v_type and assessment_id=v_id;
    v_result:=jsonb_build_object('deleted',true);
  elsif p_action='override_delete_all' then
    delete from public.gradebook_score_overrides where classroom_id=p_classroom_id;
    v_result:=jsonb_build_object('deleted',true);
  elsif p_action in ('item_create','item_update','item_weight','item_delete','item_return_marks') then
    v_inner:=public.mutate_gradebook_item(p_actor_id,p_classroom_id,substr(p_action,6),v_id,
      p_payload->>'title',(p_payload->>'points_possible')::numeric,v_category,
      (p_payload->>'gradebook_weight')::integer,(p_payload->>'include_in_final')::boolean);
    if p_action in ('item_create','item_update','item_weight') then
      v_item:=v_inner->'item';
      if v_inner->'ok' is distinct from 'true'::jsonb
        or v_item->>'id' is distinct from v_id::text or v_item->>'classroom_id' is distinct from p_classroom_id::text then
        raise exception using errcode='PT503', message='gradebook_invalid_acknowledgement';
      end if;
      v_result:=jsonb_build_object('ok',true,'item',jsonb_build_object(
        'id',v_item->'id','classroom_id',v_item->'classroom_id','title',v_item->'title','points_possible',v_item->'points_possible','gradebook_category_id',v_item->'gradebook_category_id','gradebook_weight',v_item->'gradebook_weight','include_in_final',v_item->'include_in_final','created_by',v_item->'created_by','created_at',v_item->'created_at','updated_at',v_item->'updated_at','gradebook_maximum_override',v_item->'gradebook_maximum_override','gradebook_score_scale',v_item->'gradebook_score_scale'));
    else
      v_result:=v_inner;
      if (p_action='item_delete' and v_result is distinct from '{"ok":true,"deleted":true}'::jsonb)
        or (p_action='item_return_marks' and (
          jsonb_typeof(v_result->'returned_count') is distinct from 'number'
          or v_result->'ok' is distinct from 'true'::jsonb
          or v_result-array['ok','returned_count']<>'{}'::jsonb)) then
        raise exception using errcode='PT503', message='gradebook_invalid_acknowledgement';
      end if;
    end if;
  elsif p_action='item_score' then
    v_result:=public.save_gradebook_effective_mark(p_actor_id,p_classroom_id,'item',v_id,v_student,(p_payload->>'earned')::numeric);
  elsif p_action='maximum' then
    v_result:=public.set_gradebook_maximum_override(p_actor_id,p_classroom_id,v_type,v_id,
      (p_payload->>'maximum')::numeric,p_payload->>'mode',(p_payload->>'expected_maximum')::numeric,(p_payload->>'expected_scale')::numeric);
  end if;
  if p_action in ('override_save','item_score','maximum') and v_result is distinct from '{"saved":true}'::jsonb then
    raise exception using errcode='PT503', message='gradebook_invalid_acknowledgement';
  end if;
  -- This target proves request identity only. Native contracts check effects.
  v_target:=case
    when p_action in ('assessment_weight','assessment_details','maximum') then
      jsonb_build_object('assessment_type',v_type,'assessment_id',v_id)
    when p_action in ('override_save','override_delete_one') then
      jsonb_build_object('assessment_type',v_type,'assessment_id',v_id,'student_id',v_student)
    when p_action='override_delete_all' then '{}'::jsonb
    when p_action='categories_replace' then jsonb_build_object('category_ids',(
      select jsonb_agg(c->'id' order by ord) from jsonb_array_elements(p_payload->'categories') with ordinality as category_rows(c,ord)))
    when p_action='item_score' then jsonb_build_object('item_id',v_id,'student_id',v_student)
    else jsonb_build_object('item_id',v_id) end;
  v_result:=jsonb_build_object('actor_id',p_actor_id,'classroom',private.gradebook_classroom_json_v1(v_classroom),
    'operation',p_action,'target',v_target,'result',v_result);
  if clock_timestamp()>=v_deadline or octet_length(v_result::text)>20971520 then
    raise exception using errcode='PT503', message='gradebook_completion_limit';
  end if;
  return v_result;
-- Existing CAS and164 contention produce bounded conflicts, never retries.
-- Persisted55000 lifecycle errors retain their existing nonretryable meaning.
exception when sqlstate '40001' or sqlstate '40P01' or sqlstate '55P03' then
  raise exception using errcode='PT409', message='gradebook_operation_conflict';
when invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value then
  raise exception using errcode='PT400', message='gradebook_invalid_payload';
when unique_violation then
  get stacked diagnostics v_message=message_text;
  if v_message='gradebook_item_create_conflict' then raise exception using errcode='PT409', message='gradebook_item_create_conflict'; end if;
  raise;
end;
$function$;

revoke all on function public.get_gradebook_for_owner_v1(uuid,uuid,uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.get_gradebook_for_member_v1(uuid,uuid,text,timestamptz) from public,anon,authenticated;
revoke all on function public.mutate_gradebook_for_owner_v1(uuid,uuid,text,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.get_gradebook_for_owner_v1(uuid,uuid,uuid,timestamptz) to service_role;
grant execute on function public.get_gradebook_for_member_v1(uuid,uuid,text,timestamptz) to service_role;
grant execute on function public.mutate_gradebook_for_owner_v1(uuid,uuid,text,jsonb,timestamptz) to service_role;
commit;
