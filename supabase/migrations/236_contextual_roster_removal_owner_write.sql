-- Dormant shared-admission preserving removal. Existing164 and retained-generation
-- uniqueness/cleanup controls remain intact. Duplicate identities fail before DML.
begin;

create function private.valid_roster_removal_result_v1(p_result jsonb,p_actor_id uuid,
  p_classroom_id uuid,p_roster_ids uuid[])
returns boolean language plpgsql immutable set search_path = '' as $function$
declare v_id uuid;
begin
  if pg_catalog.jsonb_typeof(p_result) is distinct from 'object' then return false; end if;
  if (select count(*) <> 5 from pg_catalog.jsonb_object_keys(p_result))
    or not p_result ?& array['actor_id','classroom_id','roster_ids','requested_count','removed_count']
    or p_result->'actor_id' is distinct from pg_catalog.to_jsonb(p_actor_id)
    or p_result->'classroom_id' is distinct from pg_catalog.to_jsonb(p_classroom_id)
    or p_result->'roster_ids' is distinct from pg_catalog.to_jsonb(p_roster_ids)
    or pg_catalog.jsonb_typeof(p_result->'requested_count') is distinct from 'number'
    or pg_catalog.jsonb_typeof(p_result->'removed_count') is distinct from 'number'
    or p_result->>'requested_count' !~ '^[0-9]{1,3}$'
    or p_result->>'removed_count' !~ '^[0-9]{1,3}$' then return false; end if;
  if not private.valid_material_owner_write_uuid_v1(p_actor_id)
    or not private.valid_material_owner_write_uuid_v1(p_classroom_id)
    or p_roster_ids is null or pg_catalog.array_ndims(p_roster_ids) is distinct from 1
    or pg_catalog.cardinality(p_roster_ids) not between 1 and 100
    or (p_result->>'requested_count')::integer <> pg_catalog.cardinality(p_roster_ids)
    or (p_result->>'removed_count')::integer > pg_catalog.cardinality(p_roster_ids) then return false; end if;
  foreach v_id in array p_roster_ids loop
    if not private.valid_material_owner_write_uuid_v1(v_id) then return false; end if;
  end loop;
  return p_roster_ids is not distinct from (select pg_catalog.array_agg(distinct id order by id)
    from pg_catalog.unnest(p_roster_ids) id);
end;
$function$;

create function public.remove_classroom_students_for_owner_v1(p_actor_id uuid,p_classroom_id uuid,p_roster_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_class public.classrooms%rowtype;
  v_roster public.classroom_roster%rowtype;
  v_returned public.classroom_roster%rowtype;
  v_enrollment public.classroom_enrollments%rowtype;
  v_mapping public.attendance_participant_mappings%rowtype;
  v_binding public.classroom_roster_student_bindings%rowtype;
  v_ids uuid[];
  v_id uuid;
  v_student_id uuid;
  v_candidates uuid[];
  v_context jsonb := '{}'::jsonb;
  v_expected_roster jsonb;
  v_expected_bindings jsonb;
  v_expected_enrollments jsonb;
  v_expected_mappings jsonb;
  v_binding_time timestamptz;
  v_removed_at timestamptz;
  v_count integer;
  v_removed_count integer := 0;
  v_result jsonb;
begin
  if not private.valid_material_owner_write_uuid_v1(p_actor_id)
    or not private.valid_material_owner_write_uuid_v1(p_classroom_id)
    or p_roster_ids is null or pg_catalog.array_ndims(p_roster_ids) is distinct from 1
    or pg_catalog.cardinality(p_roster_ids) not between 1 and 100 then
    raise exception using errcode='22023',message='Invalid roster removal request';
  end if;
  foreach v_id in array p_roster_ids loop
    if not private.valid_material_owner_write_uuid_v1(v_id) then
      raise exception using errcode='22023',message='Invalid roster removal request';
    end if;
  end loop;
  select pg_catalog.array_agg(distinct id order by id) into v_ids from pg_catalog.unnest(p_roster_ids) id;
  begin
    perform private.try_lock_classroom_membership_change(p_classroom_id);
    perform public.guard_classroom_purge_lifecycle(p_classroom_id);
    select * into v_class from public.classrooms where id=p_classroom_id for update nowait;
    if not found or v_class.teacher_id is distinct from p_actor_id or v_class.archived_at is not null then
      raise exception using errcode='42501',message='Class removal forbidden';
    end if;

    -- Lock even currently NONmatching enrolled/bound/retained users before using
    -- account email. Otherwise an email update can race invitation classification.
    perform 1 from public.users u where u.id in (
      select e.student_id from public.classroom_enrollments e where e.classroom_id=p_classroom_id
      union select b.student_id from public.classroom_roster_student_bindings b
        where b.classroom_id=p_classroom_id or exists(select 1 from public.classroom_roster r
          where r.id=b.roster_id and r.classroom_id=p_classroom_id)
      union select r.removed_student_id from public.classroom_roster r where r.classroom_id=p_classroom_id
    ) order by u.id for share nowait;
    -- Lock full class sets to preserve nonselected history and detect trigger drift.
    perform 1 from public.classroom_roster r where r.classroom_id=p_classroom_id order by r.id for update nowait;
    perform 1 from public.classroom_roster_student_bindings b where b.classroom_id=p_classroom_id
      or exists(select 1 from public.classroom_roster r where r.id=b.roster_id and r.classroom_id=p_classroom_id)
      order by b.roster_id for share nowait;
    perform 1 from public.classroom_enrollments e where e.classroom_id=p_classroom_id order by e.id for update nowait;
    perform 1 from public.attendance_participant_mappings m where m.classroom_id=p_classroom_id order by m.student_id for update nowait;
    perform 1 from public.classroom_archive_revisions where classroom_id=p_classroom_id for update nowait;
    if not found then raise exception using errcode='PT503',message='Unable to verify class removal'; end if;
    if (select count(*) from public.classroom_roster r where r.classroom_id=p_classroom_id and r.id=any(v_ids))
      <> pg_catalog.cardinality(v_ids) then
      raise exception using errcode='PT409',message='Roster selection changed';
    end if;

    -- Resolve every active selected row before changing anything. Stable binding
    -- wins over current account email; global role is never membership evidence.
    for v_roster in select * from public.classroom_roster where classroom_id=p_classroom_id and id=any(v_ids) order by id loop
      if v_roster.removed_at is not null then continue; end if;
      if not private.valid_roster_owner_write_row_v1(v_roster) then
        raise exception using errcode='PT503',message='Unable to verify class removal';
      end if;
      select * into v_binding from public.classroom_roster_student_bindings where roster_id=v_roster.id;
      if found then
        if v_binding.classroom_id is distinct from p_classroom_id then
          raise exception using errcode='PT409',message='Roster binding changed';
        end if;
        v_student_id:=v_binding.student_id;
        perform private.roster_owner_write_binding_v1(v_roster.id,p_classroom_id,v_student_id);
      else
        select pg_catalog.array_agg(e.student_id order by e.student_id) into v_candidates
          from public.classroom_enrollments e join public.users u on u.id=e.student_id
          where e.classroom_id=p_classroom_id
            and pg_catalog.lower(pg_catalog.btrim(u.email))=pg_catalog.lower(pg_catalog.btrim(v_roster.email));
        if coalesce(pg_catalog.cardinality(v_candidates),0)>1 then
          raise exception using errcode='PT409',message='Ambiguous roster identity';
        end if;
        v_student_id:=v_candidates[1];
        if v_student_id is null and exists(select 1 from public.classroom_enrollments e
          where e.classroom_id=p_classroom_id and not exists(select 1 from public.classroom_roster_student_bindings b
            where b.classroom_id=p_classroom_id and b.student_id=e.student_id)) then
          raise exception using errcode='PT409',message='Ambiguous roster identity';
        end if;
      end if;
      -- Historical email/current retained account email may identify an old
      -- member even when this selected invitation has no stable binding.
      if exists(select 1 from public.classroom_roster r left join public.users u on u.id=r.removed_student_id
        where r.classroom_id=p_classroom_id and r.removed_at is not null
          and (r.removed_student_id=v_student_id
            or pg_catalog.lower(pg_catalog.btrim(r.email))=pg_catalog.lower(pg_catalog.btrim(v_roster.email))
            or pg_catalog.lower(pg_catalog.btrim(u.email))=pg_catalog.lower(pg_catalog.btrim(v_roster.email)))) then
        raise exception using errcode='PT409',message='Student class data pending purge';
      end if;
      if v_student_id is not null then
        if not exists(select 1 from public.classroom_enrollments where classroom_id=p_classroom_id and student_id=v_student_id) then
          raise exception using errcode='PT409',message='Roster binding changed';
        end if;
        --164 retained uniqueness and173 generation controls permit one deny row.
        -- Both one-selected and all-selected duplicates must fail without DML.
        if (select count(*) from public.classroom_roster r left join public.classroom_roster_student_bindings b on b.roster_id=r.id
          where r.classroom_id=p_classroom_id and r.removed_at is null
            and (b.student_id=v_student_id or (b.roster_id is null and exists(select 1
              from public.classroom_enrollments e join public.users u on u.id=e.student_id
              where e.classroom_id=p_classroom_id and e.student_id=v_student_id
                and pg_catalog.lower(pg_catalog.btrim(u.email))=pg_catalog.lower(pg_catalog.btrim(r.email))))))>1 then
          raise exception using errcode='PT409',message='This student has multiple roster rows. Resolve the duplicate roster entries before removing them.';
        end if;
      end if;
      v_context:=pg_catalog.jsonb_set(v_context,array[v_roster.id::text],coalesce(pg_catalog.to_jsonb(v_student_id),'null'::jsonb));
    end loop;
    for v_student_id in select distinct value::uuid from pg_catalog.jsonb_each_text(v_context)
      where value is not null order by 1 loop
      perform private.try_lock_classroom_membership_change(p_classroom_id,v_student_id);
      if exists(select 1 from public.student_purge_fences where classroom_id=p_classroom_id and student_id=v_student_id) then
        raise exception using errcode='PT409',message='Student purge active';
      end if;
    end loop;
    -- Existing168 removal triggers retain membership generation evidence. Acquire
    -- their implicit row lock now so contention also returns409 without waiting.
    perform 1 from private.pal_membership_generations g where g.generation_id in (
      select e.id from public.classroom_enrollments e where e.classroom_id=p_classroom_id
        and e.student_id in (select value::uuid from pg_catalog.jsonb_each_text(v_context) where value is not null)
    ) order by g.generation_id for update nowait;

    select coalesce(pg_catalog.jsonb_object_agg(r.id::text,pg_catalog.to_jsonb(r)),'{}'::jsonb) into v_expected_roster
      from public.classroom_roster r where r.classroom_id=p_classroom_id;
    select coalesce(pg_catalog.jsonb_object_agg(b.roster_id::text,pg_catalog.to_jsonb(b)),'{}'::jsonb) into v_expected_bindings
      from public.classroom_roster_student_bindings b where b.classroom_id=p_classroom_id
        or exists(select 1 from public.classroom_roster r where r.id=b.roster_id and r.classroom_id=p_classroom_id);
    select coalesce(pg_catalog.jsonb_object_agg(e.id::text,pg_catalog.to_jsonb(e)),'{}'::jsonb) into v_expected_enrollments
      from public.classroom_enrollments e where e.classroom_id=p_classroom_id;
    select coalesce(pg_catalog.jsonb_object_agg(m.student_id::text,pg_catalog.to_jsonb(m)),'{}'::jsonb) into v_expected_mappings
      from public.attendance_participant_mappings m where m.classroom_id=p_classroom_id;

    for v_id in select key::uuid from pg_catalog.jsonb_each(v_context) order by 1 loop
      select * into v_roster from public.classroom_roster where id=v_id and classroom_id=p_classroom_id;
      if not found or v_roster.removed_at is not null or pg_catalog.to_jsonb(v_roster) is distinct from v_expected_roster->v_id::text then
        raise exception using errcode='PT409',message='Roster selection changed';
      end if;
      v_student_id:=(v_context->>v_id::text)::uuid;
      if v_student_id is null then
        delete from public.classroom_roster where id=v_id and classroom_id=p_classroom_id;
        get diagnostics v_count=row_count;
        if v_count<>1 then raise exception using errcode='PT409',message='Roster deletion suppressed'; end if;
        v_expected_roster:=v_expected_roster-v_id::text;
      else
        select * into v_enrollment from public.classroom_enrollments where classroom_id=p_classroom_id and student_id=v_student_id;
        if not found or pg_catalog.to_jsonb(v_enrollment) is distinct from v_expected_enrollments->v_enrollment.id::text then
          raise exception using errcode='PT409',message='Enrollment changed';
        end if;
        select * into v_mapping from public.attendance_participant_mappings where classroom_id=p_classroom_id and student_id=v_student_id;
        if (found and pg_catalog.to_jsonb(v_mapping) is distinct from v_expected_mappings->v_student_id::text)
          or (not found and v_expected_mappings ? v_student_id::text) then
          raise exception using errcode='PT409',message='Attendance mapping changed';
        end if;
        if not v_expected_bindings ? v_id::text then
          v_binding_time:=pg_catalog.clock_timestamp();
          insert into public.classroom_roster_student_bindings(roster_id,classroom_id,student_id,created_at)
            values(v_id,p_classroom_id,v_student_id,v_binding_time) returning * into v_binding;
          if not found or pg_catalog.to_jsonb(v_binding) is distinct from pg_catalog.jsonb_build_object(
            'roster_id',v_id,'classroom_id',p_classroom_id,'student_id',v_student_id,'created_at',v_binding_time) then
            raise exception using errcode='PT409',message='Roster binding changed';
          end if;
          v_expected_bindings:=pg_catalog.jsonb_set(v_expected_bindings,array[v_id::text],pg_catalog.to_jsonb(v_binding));
        end if;
        v_removed_at:=pg_catalog.clock_timestamp();
        v_expected_roster:=pg_catalog.jsonb_set(v_expected_roster,array[v_id::text],pg_catalog.to_jsonb(v_roster)
          || pg_catalog.jsonb_build_object('removed_at',v_removed_at,'removed_student_id',v_student_id,
            'removed_enrollment_id',v_enrollment.id,'removed_enrolled_at',v_enrollment.created_at,
            'retained_manual_attendance_marks',v_enrollment.manual_attendance_marks,
            'retained_attendance_participant_active',v_mapping.active,'updated_at',pg_catalog.transaction_timestamp()));
        update public.classroom_roster set removed_at=v_removed_at,removed_student_id=v_student_id,
          removed_enrollment_id=v_enrollment.id,removed_enrolled_at=v_enrollment.created_at,
          retained_manual_attendance_marks=v_enrollment.manual_attendance_marks,
          retained_attendance_participant_active=v_mapping.active where id=v_id and classroom_id=p_classroom_id
          returning * into v_returned;
        if not found or pg_catalog.to_jsonb(v_returned) is distinct from v_expected_roster->v_id::text then
          raise exception using errcode='PT409',message='Roster removal changed';
        end if;
        delete from public.classroom_enrollments where id=v_enrollment.id and classroom_id=p_classroom_id and student_id=v_student_id;
        get diagnostics v_count=row_count;
        if v_count<>1 then raise exception using errcode='PT409',message='Enrollment deletion suppressed'; end if;
        v_expected_enrollments:=v_expected_enrollments-v_enrollment.id::text;
        if v_mapping.active is true then
          update public.attendance_participant_mappings set active=false,updated_at=v_removed_at
            where classroom_id=p_classroom_id and student_id=v_student_id and active;
          get diagnostics v_count=row_count;
          if v_count<>1 then raise exception using errcode='PT409',message='Attendance update suppressed'; end if;
          v_expected_mappings:=pg_catalog.jsonb_set(v_expected_mappings,array[v_student_id::text],pg_catalog.to_jsonb(v_mapping)
            || pg_catalog.jsonb_build_object('active',false,'updated_at',v_removed_at));
        end if;
      end if;
      v_removed_count:=v_removed_count+1;
    end loop;

    -- All AFTER triggers have run. Full row equality protects six retained fields,
    -- identity/display, derived stable bindings, and nonselected class history.
    if v_expected_roster is distinct from (select coalesce(pg_catalog.jsonb_object_agg(r.id::text,pg_catalog.to_jsonb(r)),'{}'::jsonb)
        from public.classroom_roster r where r.classroom_id=p_classroom_id)
      or v_expected_bindings is distinct from (select coalesce(pg_catalog.jsonb_object_agg(b.roster_id::text,pg_catalog.to_jsonb(b)),'{}'::jsonb)
        from public.classroom_roster_student_bindings b where b.classroom_id=p_classroom_id
          or exists(select 1 from public.classroom_roster r where r.id=b.roster_id and r.classroom_id=p_classroom_id))
      or v_expected_enrollments is distinct from (select coalesce(pg_catalog.jsonb_object_agg(e.id::text,pg_catalog.to_jsonb(e)),'{}'::jsonb)
        from public.classroom_enrollments e where e.classroom_id=p_classroom_id)
      or v_expected_mappings is distinct from (select coalesce(pg_catalog.jsonb_object_agg(m.student_id::text,pg_catalog.to_jsonb(m)),'{}'::jsonb)
        from public.attendance_participant_mappings m where m.classroom_id=p_classroom_id) then
      raise exception using errcode='PT409',message='Roster persisted set changed';
    end if;
    perform 1 from public.classrooms where id=p_classroom_id and teacher_id=p_actor_id and archived_at is null;
    if not found then raise exception using errcode='PT409',message='Classroom binding changed'; end if;
    v_result:=pg_catalog.jsonb_build_object('actor_id',p_actor_id,'classroom_id',p_classroom_id,'roster_ids',v_ids,
      'requested_count',pg_catalog.cardinality(v_ids),'removed_count',v_removed_count);
    if not private.valid_roster_removal_result_v1(v_result,p_actor_id,p_classroom_id,v_ids) then
      raise exception using errcode='PT503',message='Unable to verify class removal';
    end if;
    return v_result;
  exception when sqlstate '40001' or sqlstate '40P01' or sqlstate '55P03' or sqlstate '55000' then
    raise exception using errcode='PT409',message='Roster operation busy';
  end;
end;
$function$;

revoke all on function private.valid_roster_removal_result_v1(jsonb,uuid,uuid,uuid[]) from public,anon,authenticated,service_role;
revoke all on function public.remove_classroom_students_for_owner_v1(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.remove_classroom_students_for_owner_v1(uuid,uuid,uuid[]) to service_role;
commit;
