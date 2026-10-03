-- Source candidate. Shared admission remains OFF; no cleanup/restore capabilities.
begin;

create function private.valid_roster_owner_write_values_v1(p_value jsonb, p_incoming boolean)
returns boolean language sql immutable set search_path = '' as $function$
  select coalesce(pg_catalog.jsonb_typeof(p_value) = 'object'
    and (select count(*) = 4 from pg_catalog.jsonb_object_keys(p_value))
    and p_value ?& array['firstName','lastName','studentNumber','counselorEmail']
    and (pg_catalog.jsonb_typeof(p_value->'firstName') = 'string'
      or (not p_incoming and p_value->'firstName' = 'null'::jsonb))
    and (pg_catalog.jsonb_typeof(p_value->'lastName') = 'string'
      or (not p_incoming and p_value->'lastName' = 'null'::jsonb))
    and (p_value->'studentNumber' = 'null'::jsonb or pg_catalog.jsonb_typeof(p_value->'studentNumber') = 'string')
    and (p_value->'counselorEmail' = 'null'::jsonb or pg_catalog.jsonb_typeof(p_value->'counselorEmail') = 'string')
    and coalesce(pg_catalog.char_length(p_value->>'firstName'),0) between case when p_incoming then 1 else 0 end and 500
    and coalesce(pg_catalog.char_length(p_value->>'lastName'),0) between case when p_incoming then 1 else 0 end and 500
    and coalesce(pg_catalog.char_length(p_value->>'studentNumber'),0) <= 128
    and coalesce(pg_catalog.char_length(p_value->>'counselorEmail'),0) <= 320, false);
$function$;

create function private.roster_owner_write_values_v1(p_row public.classroom_roster)
returns jsonb language sql immutable set search_path = '' as $function$
  select pg_catalog.jsonb_build_object('firstName',(p_row).first_name,'lastName',(p_row).last_name,
    'studentNumber',(p_row).student_number,'counselorEmail',(p_row).counselor_email);
$function$;

create function private.valid_roster_owner_write_row_v1(p_row public.classroom_roster)
returns boolean language sql stable set search_path = '' as $function$
  -- Full persisted transport is checked before commit, not only the HTTP projection.
  select coalesce((select count(*) = 16 from pg_catalog.jsonb_object_keys(pg_catalog.to_jsonb(p_row)))
    and private.valid_material_owner_write_uuid_v1((p_row).id)
    and private.valid_material_owner_write_uuid_v1((p_row).classroom_id)
    and (p_row).email is not null and pg_catalog.char_length((p_row).email) between 1 and 320
    and (p_row).join_source is not null and (p_row).removed_at is null
    and private.valid_roster_owner_write_values_v1(private.roster_owner_write_values_v1(p_row),false)
    and private.valid_material_owner_write_timestamp_v1((p_row).created_at)
    and private.valid_material_owner_write_timestamp_v1((p_row).updated_at)
    and ((p_row).removed_enrolled_at is null or private.valid_material_owner_write_timestamp_v1((p_row).removed_enrolled_at))
    and ((p_row).removed_enrollment_id is null or private.valid_material_owner_write_uuid_v1((p_row).removed_enrollment_id))
    and ((p_row).removed_student_id is null or private.valid_material_owner_write_uuid_v1((p_row).removed_student_id)),false);
$function$;

create function private.roster_owner_write_binding_v1(p_roster_id uuid, p_classroom_id uuid, p_student_id uuid)
returns jsonb language plpgsql stable set search_path = '' as $function$
declare v_binding public.classroom_roster_student_bindings%rowtype;
begin
  select * into v_binding from public.classroom_roster_student_bindings where roster_id = p_roster_id;
  if not found then
    if p_student_id is not null then raise exception using errcode='PT409',message='Roster binding changed'; end if;
    return 'null'::jsonb;
  end if;
  if v_binding.classroom_id is distinct from p_classroom_id or v_binding.student_id is distinct from p_student_id then
    raise exception using errcode='PT409',message='Roster binding changed';
  end if;
  if not private.valid_material_owner_write_uuid_v1(v_binding.student_id)
    or not private.valid_material_owner_write_timestamp_v1(v_binding.created_at)
    or (select count(*) <> 4 from pg_catalog.jsonb_object_keys(pg_catalog.to_jsonb(v_binding))) then
    raise exception using errcode='PT503',message='Unable to verify roster mutation';
  end if;
  return pg_catalog.to_jsonb(v_binding);
end;
$function$;

create function private.lock_roster_owner_context_v1(p_actor_id uuid, p_classroom_id uuid,
  p_emails text[], p_roster_id uuid default null)
returns jsonb language plpgsql set search_path = '' as $function$
declare
  v_class public.classrooms%rowtype;
  v_id uuid;
  v_email text;
  v_roster public.classroom_roster%rowtype;
  v_student_id uuid;
  v_candidates uuid[];
  v_context jsonb := '[]'::jsonb;
begin
  perform private.try_lock_classroom_membership_change(p_classroom_id);
  perform public.guard_classroom_purge_lifecycle(p_classroom_id);
  select * into v_class from public.classrooms where id = p_classroom_id for update nowait;
  if not found then raise exception using errcode='P0002',message='Classroom not found'; end if;
  if v_class.teacher_id is distinct from p_actor_id then raise exception using errcode='42501',message='Forbidden'; end if;
  if v_class.archived_at is not null then raise exception using errcode='42501',message='Classroom archived'; end if;

  -- Stabilize ALL relevant user emails BEFORE matching. An unmatched removed
  -- account can change its email to an incoming email without a classroom lock.
  perform 1 from public.users u where u.id in (
    select e.student_id from public.classroom_enrollments e where e.classroom_id=p_classroom_id
    union select b.student_id from public.classroom_roster_student_bindings b where b.classroom_id=p_classroom_id
    union select r.removed_student_id from public.classroom_roster r where r.classroom_id=p_classroom_id
  ) order by u.id for share nowait;
  if p_roster_id is not null then
    select * into v_roster from public.classroom_roster where id=p_roster_id and classroom_id=p_classroom_id;
    if not found then raise exception using errcode='PT404',message='Roster entry not found'; end if;
    p_emails := array[pg_catalog.lower(private.material_owner_write_title_v1(v_roster.email))];
  end if;
  if exists(select 1 from public.classroom_roster r left join public.users u on u.id=r.removed_student_id
    where r.classroom_id=p_classroom_id and r.removed_at is not null
      and (pg_catalog.lower(private.material_owner_write_title_v1(r.email))=any(p_emails)
        or pg_catalog.lower(private.material_owner_write_title_v1(u.email))=any(p_emails))) then
    raise exception using errcode='PT409',message='Student class data pending purge';
  end if;
  foreach v_email in array p_emails loop
    if (select count(*) from public.classroom_roster r where r.classroom_id=p_classroom_id
      and pg_catalog.lower(private.material_owner_write_title_v1(r.email))=v_email) > 1 then
      raise exception using errcode='PT409',message='Ambiguous roster identity';
    end if;
    select * into v_roster from public.classroom_roster r where r.classroom_id=p_classroom_id
      and pg_catalog.lower(private.material_owner_write_title_v1(r.email))=v_email;
    if exists(select 1 from public.classroom_roster_student_bindings b where b.roster_id=v_roster.id
      and b.classroom_id is distinct from p_classroom_id) then
      raise exception using errcode='PT409',message='Roster binding changed';
    end if;
    select pg_catalog.array_agg(distinct candidate.student_id order by candidate.student_id) into v_candidates
    from (
      select b.student_id from public.classroom_roster_student_bindings b where b.roster_id=v_roster.id
      union select e.student_id from public.classroom_enrollments e join public.users u on u.id=e.student_id
        where e.classroom_id=p_classroom_id and pg_catalog.lower(private.material_owner_write_title_v1(u.email))=v_email
          and not exists(select 1 from public.classroom_roster_student_bindings b where b.roster_id=v_roster.id)
    ) candidate;
    if coalesce(pg_catalog.array_length(v_candidates,1),0)>1 then
      raise exception using errcode='PT409',message='Ambiguous roster identity';
    end if;
    v_student_id := v_candidates[1];
    if exists(select 1 from public.classroom_roster_student_bindings b where b.roster_id=v_roster.id) then
      perform private.roster_owner_write_binding_v1(v_roster.id,p_classroom_id,v_student_id);
    end if;
    v_context := v_context || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'email',v_email,'roster_id',v_roster.id,'student_id',v_student_id));
  end loop;
  -- Deterministic subject/pair locks; never wait behind subject-first purges.
  for v_id in select distinct (item->>'student_id')::uuid from pg_catalog.jsonb_array_elements(v_context) item
    where item->>'student_id' is not null order by 1 loop
    perform private.try_lock_classroom_membership_change(p_classroom_id,v_id);
    -- Explicit role-independent fence: teacher-valued enrolled learners count.
    if exists(select 1 from public.student_purge_fences where classroom_id=p_classroom_id and student_id=v_id) then
      raise exception using errcode='PT409',message='Student purge active';
    end if;
  end loop;
  perform 1 from public.classroom_roster r where r.classroom_id=p_classroom_id order by r.id for update nowait;
  perform 1 from public.classroom_roster_student_bindings b where b.classroom_id=p_classroom_id order by b.roster_id for share nowait;
  perform 1 from public.classroom_enrollments e where e.classroom_id=p_classroom_id order by e.id for share nowait;
  -- Pre-acquire the revision row: legacy row-first triggers cannot make us wait.
  perform 1 from public.classroom_archive_revisions where classroom_id=p_classroom_id for update nowait;
  if not found then raise exception using errcode='PT503',message='Unable to verify roster mutation'; end if;
  return v_context;
end;
$function$;

create function public.upsert_classroom_roster_for_owner_v1(p_actor_id uuid,p_classroom_id uuid,
  p_students jsonb,p_mode text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_context jsonb;
  v_item jsonb;
  v_identity jsonb;
  v_values jsonb;
  v_before public.classroom_roster%rowtype;
  v_returned public.classroom_roster%rowtype;
  v_row public.classroom_roster%rowtype;
  v_id uuid;
  v_student_id uuid;
  v_emails text[];
  v_roster_snapshot jsonb;
  v_binding_snapshot jsonb;
  v_enrollment_snapshot jsonb;
  v_expected_bindings jsonb;
  v_expected_roster jsonb;
  v_binding jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_changes jsonb := '[]'::jsonb;
  v_new_count integer := 0;
begin
  if not private.valid_material_owner_write_uuid_v1(p_actor_id)
    or not private.valid_material_owner_write_uuid_v1(p_classroom_id)
    or p_mode is null or p_mode not in ('manual','csv-preview','csv-confirmed')
    or pg_catalog.jsonb_typeof(p_students) is distinct from 'array' then
    raise exception using errcode='22023',message='Invalid roster mutation request';
  end if;
  if pg_catalog.jsonb_array_length(p_students) not between 1 and 1000 then
    raise exception using errcode='22023',message='Invalid roster mutation request';
  end if;
  for v_item in select value from pg_catalog.jsonb_array_elements(p_students) loop
    if pg_catalog.jsonb_typeof(v_item) is distinct from 'object' then
      raise exception using errcode='22023',message='Invalid roster mutation request';
    end if;
    if (select count(*) <> 5 from pg_catalog.jsonb_object_keys(v_item))
      or pg_catalog.jsonb_typeof(v_item->'email') is distinct from 'string'
      or pg_catalog.char_length(v_item->>'email') not between 1 and 320
      or v_item->>'email' is distinct from pg_catalog.lower(private.material_owner_write_title_v1(v_item->>'email'))
      or not private.valid_roster_owner_write_values_v1(v_item-'email',true)
      or (v_item->>'counselorEmail' is not null and (v_item->>'counselorEmail' = ''
        or v_item->>'counselorEmail' is distinct from pg_catalog.lower(private.material_owner_write_title_v1(v_item->>'counselorEmail')))) then
      raise exception using errcode='22023',message='Invalid roster mutation request';
    end if;
  end loop;
  select pg_catalog.array_agg(item->>'email' order by item->>'email') into v_emails from pg_catalog.jsonb_array_elements(p_students) item;
  if (select count(distinct email) from pg_catalog.unnest(v_emails) email) <> pg_catalog.array_length(v_emails,1) then
    raise exception using errcode='22023',message='Duplicate roster emails';
  end if;
  begin
    v_context := private.lock_roster_owner_context_v1(p_actor_id,p_classroom_id,v_emails);
    select coalesce(pg_catalog.jsonb_object_agg(r.id::text,pg_catalog.to_jsonb(r)),'{}'::jsonb) into v_roster_snapshot
      from public.classroom_roster r where r.classroom_id=p_classroom_id;
    select coalesce(pg_catalog.jsonb_object_agg(b.roster_id::text,pg_catalog.to_jsonb(b)),'{}'::jsonb) into v_binding_snapshot
      from public.classroom_roster_student_bindings b where b.classroom_id=p_classroom_id;
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(e) order by e.id),'[]'::jsonb) into v_enrollment_snapshot
      from public.classroom_enrollments e where e.classroom_id=p_classroom_id;
    v_expected_roster := v_roster_snapshot;
    v_expected_bindings := v_binding_snapshot;
    for v_item in select value from pg_catalog.jsonb_array_elements(p_students) loop
      select item into v_identity from pg_catalog.jsonb_array_elements(v_context) item where item->>'email'=v_item->>'email';
      v_id := (v_identity->>'roster_id')::uuid;
      if v_id is null then v_new_count:=v_new_count+1; continue; end if;
      select * into v_before from public.classroom_roster where id=v_id and classroom_id=p_classroom_id;
      if not found or v_before.removed_at is not null then raise exception using errcode='PT409',message='Roster changed'; end if;
      if p_mode='csv-preview' then
        if not private.valid_roster_owner_write_row_v1(v_before) then
          raise exception using errcode='PT503',message='Unable to verify roster mutation';
        end if;
        v_values := private.roster_owner_write_values_v1(v_before);
        if not private.valid_roster_owner_write_values_v1(v_values,false) then
          raise exception using errcode='PT503',message='Unable to verify roster mutation';
        end if;
        if v_values is distinct from v_item-'email' then
          v_changes := v_changes || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'email',v_item->>'email','current',v_values,'incoming',v_item-'email'));
        end if;
      end if;
    end loop;
    -- Preview deliberately performs no DML or derived-binding repair.
    if pg_catalog.jsonb_array_length(v_changes)>0 then
      perform 1 from public.classrooms where id=p_classroom_id and teacher_id=p_actor_id and archived_at is null;
      if not found then raise exception using errcode='PT409',message='Classroom binding changed'; end if;
      return pg_catalog.jsonb_build_object('actor_id',p_actor_id,'classroom_id',p_classroom_id,'mode',p_mode,
        'needs_confirmation',true,'changes',v_changes,'update_count',pg_catalog.jsonb_array_length(v_changes),
        'new_count',v_new_count,'total_count',pg_catalog.jsonb_array_length(p_students));
    end if;
    for v_item in select value from pg_catalog.jsonb_array_elements(p_students) order by value->>'email' loop
      select item into v_identity from pg_catalog.jsonb_array_elements(v_context) item where item->>'email'=v_item->>'email';
      v_id := (v_identity->>'roster_id')::uuid;
      v_student_id := (v_identity->>'student_id')::uuid;
      if v_id is null then
        insert into public.classroom_roster(classroom_id,email,first_name,last_name,student_number,counselor_email,join_source)
        values(p_classroom_id,v_item->>'email',v_item->>'firstName',v_item->>'lastName',v_item->>'studentNumber',
          v_item->>'counselorEmail',case when p_mode='manual' then 'manual' else 'csv' end) returning * into v_returned;
        if not found then raise exception using errcode='PT409',message='Roster insert suppressed'; end if;
        v_id:=v_returned.id;
        if v_roster_snapshot ? v_id::text or v_returned.email is distinct from v_item->>'email'
          or v_returned.created_at is distinct from pg_catalog.transaction_timestamp()
          or v_returned.removed_at is not null or v_returned.removed_student_id is not null
          or v_returned.removed_enrolled_at is not null or v_returned.removed_enrollment_id is not null
          or v_returned.retained_manual_attendance_marks is not null
          or v_returned.retained_attendance_participant_active is not null then
          raise exception using errcode='PT409',message='Roster insert binding changed';
        end if;
      else
        select * into v_before from public.classroom_roster where id=v_id and classroom_id=p_classroom_id;
        update public.classroom_roster set first_name=v_item->>'firstName',last_name=v_item->>'lastName',
          student_number=v_item->>'studentNumber',counselor_email=v_item->>'counselorEmail',
          join_source=case when p_mode='manual' then 'manual' else 'csv' end
          where id=v_id and classroom_id=p_classroom_id returning * into v_returned;
        if not found or (pg_catalog.to_jsonb(v_returned)-array['first_name','last_name','student_number','counselor_email','join_source','updated_at'])
          is distinct from (pg_catalog.to_jsonb(v_before)-array['first_name','last_name','student_number','counselor_email','join_source','updated_at']) then
          raise exception using errcode='PT409',message='Roster history changed';
        end if;
      end if;
      if v_student_id is not null then
        insert into public.classroom_roster_student_bindings(roster_id,classroom_id,student_id)
          values(v_id,p_classroom_id,v_student_id) on conflict(roster_id) do nothing;
      end if;
      select * into v_row from public.classroom_roster where id=v_id and classroom_id=p_classroom_id;
      if not found or pg_catalog.to_jsonb(v_row) is distinct from pg_catalog.to_jsonb(v_returned)
        or private.roster_owner_write_values_v1(v_row) is distinct from v_item-'email'
        or v_row.join_source is distinct from case when p_mode='manual' then 'manual' else 'csv' end
        or v_row.updated_at is distinct from pg_catalog.transaction_timestamp() then
        raise exception using errcode='PT409',message='Roster write binding changed';
      end if;
      if not private.valid_roster_owner_write_row_v1(v_row) then
        raise exception using errcode='PT503',message='Unable to verify roster mutation';
      end if;
      v_binding:=private.roster_owner_write_binding_v1(v_id,p_classroom_id,v_student_id);
      if v_binding_snapshot ? v_id::text and v_binding is distinct from v_binding_snapshot->v_id::text then
        raise exception using errcode='PT409',message='Roster binding history changed';
      end if;
      if v_binding <> 'null'::jsonb then v_expected_bindings:=pg_catalog.jsonb_set(v_expected_bindings,array[v_id::text],v_binding); end if;
      v_expected_roster:=pg_catalog.jsonb_set(v_expected_roster,array[v_id::text],pg_catalog.to_jsonb(v_row));
      v_rows:=v_rows || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('roster',pg_catalog.to_jsonb(v_row),'binding',v_binding));
    end loop;
    -- Re-read the whole persisted set AFTER every row's AFTER triggers.
    if v_expected_roster is distinct from (select coalesce(pg_catalog.jsonb_object_agg(r.id::text,pg_catalog.to_jsonb(r)),'{}'::jsonb)
        from public.classroom_roster r where r.classroom_id=p_classroom_id)
      or v_expected_bindings is distinct from (select coalesce(pg_catalog.jsonb_object_agg(b.roster_id::text,pg_catalog.to_jsonb(b)),'{}'::jsonb)
        from public.classroom_roster_student_bindings b where b.classroom_id=p_classroom_id)
      or v_enrollment_snapshot is distinct from (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(e) order by e.id),'[]'::jsonb)
        from public.classroom_enrollments e where e.classroom_id=p_classroom_id) then
      raise exception using errcode='PT409',message='Roster persisted set changed';
    end if;
    perform 1 from public.classrooms where id=p_classroom_id and teacher_id=p_actor_id and archived_at is null;
    if not found then raise exception using errcode='PT409',message='Classroom binding changed'; end if;
    return pg_catalog.jsonb_build_object('actor_id',p_actor_id,'classroom_id',p_classroom_id,'mode',p_mode,'needs_confirmation',false,'rows',v_rows);
  exception when sqlstate '40001' or sqlstate '40P01' or sqlstate '55P03' or sqlstate '55000' then
    raise exception using errcode='PT409',message='Roster operation busy';
  end;
end;
$function$;

create function public.update_classroom_roster_counselor_for_owner_v1(p_actor_id uuid,p_classroom_id uuid,
  p_roster_id uuid,p_counselor_email text,p_expected_updated_at text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_context jsonb;
  v_before public.classroom_roster%rowtype;
  v_returned public.classroom_roster%rowtype;
  v_row public.classroom_roster%rowtype;
  v_student_id uuid;
  v_binding jsonb;
  v_roster_snapshot jsonb;
  v_binding_snapshot jsonb;
  v_enrollment_snapshot jsonb;
  v_expected_bindings jsonb;
  v_expected_timestamp timestamptz;
begin
  if not private.valid_material_owner_write_uuid_v1(p_actor_id)
    or not private.valid_material_owner_write_uuid_v1(p_classroom_id)
    or not private.valid_material_owner_write_uuid_v1(p_roster_id)
    or (p_counselor_email is not null and (pg_catalog.char_length(p_counselor_email)>320 or p_counselor_email=''
      or p_counselor_email is distinct from private.material_owner_write_title_v1(p_counselor_email)))
    or p_expected_updated_at is null or p_expected_updated_at !~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]+)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$' then
    raise exception using errcode='22023',message='Invalid roster update request';
  end if;
  begin
    v_expected_timestamp:=p_expected_updated_at::timestamptz;
    if not pg_catalog.isfinite(v_expected_timestamp) or extract(year from v_expected_timestamp) not between 1 and 9999 then
      raise exception using errcode='22023',message='Invalid roster timestamp';
    end if;
  exception when sqlstate '22007' or sqlstate '22008' then
    raise exception using errcode='22023',message='Invalid roster timestamp';
  end;
  begin
    v_context:=private.lock_roster_owner_context_v1(p_actor_id,p_classroom_id,array[]::text[],p_roster_id);
    v_student_id:=(v_context->0->>'student_id')::uuid;
    select * into v_before from public.classroom_roster where id=p_roster_id and classroom_id=p_classroom_id;
    if not found then raise exception using errcode='PT404',message='Roster entry not found'; end if;
    if v_before.removed_at is not null or v_before.updated_at is distinct from v_expected_timestamp then
      raise exception using errcode='PT409',message='Roster changed';
    end if;
    select coalesce(pg_catalog.jsonb_object_agg(r.id::text,pg_catalog.to_jsonb(r)),'{}'::jsonb) into v_roster_snapshot
      from public.classroom_roster r where r.classroom_id=p_classroom_id;
    select coalesce(pg_catalog.jsonb_object_agg(b.roster_id::text,pg_catalog.to_jsonb(b)),'{}'::jsonb) into v_binding_snapshot
      from public.classroom_roster_student_bindings b where b.classroom_id=p_classroom_id;
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(e) order by e.id),'[]'::jsonb) into v_enrollment_snapshot
      from public.classroom_enrollments e where e.classroom_id=p_classroom_id;
    v_expected_bindings:=v_binding_snapshot;
    -- Execute even an identical accepted value, retaining timestamp/revision behavior.
    update public.classroom_roster set counselor_email=p_counselor_email
      where id=p_roster_id and classroom_id=p_classroom_id returning * into v_returned;
    if not found then raise exception using errcode='PT409',message='Roster update suppressed'; end if;
    if v_student_id is not null then
      insert into public.classroom_roster_student_bindings(roster_id,classroom_id,student_id)
        values(p_roster_id,p_classroom_id,v_student_id) on conflict(roster_id) do nothing;
    end if;
    select * into v_row from public.classroom_roster where id=p_roster_id and classroom_id=p_classroom_id;
    if not found or pg_catalog.to_jsonb(v_row) is distinct from pg_catalog.to_jsonb(v_returned)
      or (pg_catalog.to_jsonb(v_row)-array['counselor_email','updated_at'])
        is distinct from (pg_catalog.to_jsonb(v_before)-array['counselor_email','updated_at'])
      or v_row.counselor_email is distinct from p_counselor_email
      or v_row.updated_at is distinct from pg_catalog.transaction_timestamp() then
      raise exception using errcode='PT409',message='Roster write binding changed';
    end if;
    if not private.valid_roster_owner_write_row_v1(v_row) then raise exception using errcode='PT503',message='Unable to verify roster mutation'; end if;
    v_binding:=private.roster_owner_write_binding_v1(p_roster_id,p_classroom_id,v_student_id);
    if v_binding_snapshot ? p_roster_id::text and v_binding is distinct from v_binding_snapshot->p_roster_id::text then
      raise exception using errcode='PT409',message='Roster binding history changed';
    end if;
    if v_binding <> 'null'::jsonb then v_expected_bindings:=pg_catalog.jsonb_set(v_expected_bindings,array[p_roster_id::text],v_binding); end if;
    v_roster_snapshot:=pg_catalog.jsonb_set(v_roster_snapshot,array[p_roster_id::text],pg_catalog.to_jsonb(v_row));
    if v_roster_snapshot is distinct from (select coalesce(pg_catalog.jsonb_object_agg(r.id::text,pg_catalog.to_jsonb(r)),'{}'::jsonb)
        from public.classroom_roster r where r.classroom_id=p_classroom_id)
      or v_expected_bindings is distinct from (select coalesce(pg_catalog.jsonb_object_agg(b.roster_id::text,pg_catalog.to_jsonb(b)),'{}'::jsonb)
        from public.classroom_roster_student_bindings b where b.classroom_id=p_classroom_id)
      or v_enrollment_snapshot is distinct from (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(e) order by e.id),'[]'::jsonb)
        from public.classroom_enrollments e where e.classroom_id=p_classroom_id) then
      raise exception using errcode='PT409',message='Roster persisted set changed';
    end if;
    perform 1 from public.classrooms where id=p_classroom_id and teacher_id=p_actor_id and archived_at is null;
    if not found then raise exception using errcode='PT409',message='Classroom binding changed'; end if;
    return pg_catalog.jsonb_build_object('actor_id',p_actor_id,'classroom_id',p_classroom_id,'roster',pg_catalog.to_jsonb(v_row),'binding',v_binding);
  exception when sqlstate '40001' or sqlstate '40P01' or sqlstate '55P03' or sqlstate '55000' then
    raise exception using errcode='PT409',message='Roster operation busy';
  end;
end;
$function$;

revoke all on function private.valid_roster_owner_write_values_v1(jsonb,boolean) from public,anon,authenticated,service_role;
revoke all on function private.roster_owner_write_values_v1(public.classroom_roster) from public,anon,authenticated,service_role;
revoke all on function private.valid_roster_owner_write_row_v1(public.classroom_roster) from public,anon,authenticated,service_role;
revoke all on function private.roster_owner_write_binding_v1(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function private.lock_roster_owner_context_v1(uuid,uuid,text[],uuid) from public,anon,authenticated,service_role;
revoke all on function public.upsert_classroom_roster_for_owner_v1(uuid,uuid,jsonb,text) from public,anon,authenticated;
revoke all on function public.update_classroom_roster_counselor_for_owner_v1(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.upsert_classroom_roster_for_owner_v1(uuid,uuid,jsonb,text) to service_role;
grant execute on function public.update_classroom_roster_counselor_for_owner_v1(uuid,uuid,uuid,text,text) to service_role;
commit;
