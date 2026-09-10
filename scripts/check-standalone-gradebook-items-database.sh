#!/usr/bin/env bash
set -euo pipefail

# Rollback-only fixtures on an already migrated local or disposable CI database.
# This script never applies migrations or accepts a hosted connection string.
GRADEBOOK_DB_CONTAINER="${GRADEBOOK_DB_CONTAINER:-supabase_db_pika}"
GRADEBOOK_PROJECT="${GRADEBOOK_PROJECT:-pika}"
PROJECT_LABEL="$(docker inspect "$GRADEBOOK_DB_CONTAINER" --format '{{ index .Config.Labels "com.supabase.cli.project" }}')"
if [[ "$PROJECT_LABEL" != "$GRADEBOOK_PROJECT" || "$GRADEBOOK_DB_CONTAINER" != "supabase_db_$GRADEBOOK_PROJECT" ]]; then
  echo 'Refusing unexpected database target.' >&2
  exit 2
fi

docker exec -i "$GRADEBOOK_DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
begin;
do $$ begin
  if not exists(select 1 from supabase_migrations.schema_migrations where version='161') then
    raise exception 'Migration 161 must already be applied through an authorized workflow';
  end if;
  if has_table_privilege('authenticated','public.gradebook_items','SELECT')
    or has_table_privilege('anon','public.gradebook_item_scores','SELECT')
    or has_function_privilege('authenticated','public.set_gradebook_item_score(uuid,uuid,uuid,uuid,numeric)','EXECUTE')
    or has_function_privilege('anon','public.mutate_gradebook_item(uuid,uuid,text,uuid,text,numeric,uuid,integer,boolean)','EXECUTE') then
    raise exception 'Standalone Gradebook browser privileges must be revoked';
  end if;
  if not exists(select 1 from pg_class where oid='public.gradebook_items'::regclass and relrowsecurity)
    or not exists(select 1 from pg_class where oid='public.gradebook_item_scores'::regclass and relrowsecurity) then
    raise exception 'Standalone Gradebook RLS must be enabled';
  end if;
end $$;
insert into public.users(id,email,role) values
  ('e1610000-0000-4000-8000-000000000001','standalone-contract-teacher@example.test','teacher'),
  ('e1610000-0000-4000-8000-000000000002','standalone-contract-student@example.test','student'),
  ('e1610000-0000-4000-8000-000000000003','standalone-contract-other-teacher@example.test','teacher');
insert into public.classrooms(id,teacher_id,title,class_code) values
  ('e1610000-0000-4000-8000-000000000010','e1610000-0000-4000-8000-000000000001','Standalone fixture','GB161A'),
  ('e1610000-0000-4000-8000-000000000011','e1610000-0000-4000-8000-000000000003','Other fixture','GB161B');
insert into public.classroom_roster(id,classroom_id,email) values
  ('e1610000-0000-4000-8000-000000000040','e1610000-0000-4000-8000-000000000010','standalone-contract-student@example.test');
insert into public.classroom_enrollments(classroom_id,student_id) values
  ('e1610000-0000-4000-8000-000000000010','e1610000-0000-4000-8000-000000000002');
create temporary table standalone_archive_rows(table_name text primary key, rows jsonb) on commit drop;
do $contract$
declare
  t constant uuid := 'e1610000-0000-4000-8000-000000000001';
  s constant uuid := 'e1610000-0000-4000-8000-000000000002';
  c constant uuid := 'e1610000-0000-4000-8000-000000000010';
  i constant uuid := 'e1610000-0000-4000-8000-000000000020';
  cat uuid; other_cat uuid; r jsonb; rev bigint;
  export_id constant uuid := 'e1610000-0000-4000-8000-000000000060';
  compact_id constant uuid := 'e1610000-0000-4000-8000-000000000061';
  restore_id constant uuid := 'e1610000-0000-4000-8000-000000000062';
  counts jsonb; resource record; rows_json jsonb; archive_path text;
  actors jsonb; verification jsonb; original_item jsonb; original_score jsonb;
begin
  select id into cat from public.gradebook_categories where classroom_id=c and name='Attendance';
  select id into other_cat from public.gradebook_categories where classroom_id='e1610000-0000-4000-8000-000000000011' limit 1;
  select revision into rev from public.classroom_archive_revisions where classroom_id=c;
  r := public.mutate_gradebook_item(t,c,'create',i,'Attendance – Term 1',20,cat,10,true);
  if r#>>'{item,title}' <> 'Attendance – Term 1' or exists(select 1 from public.gradebook_item_scores where item_id=i)
    or exists(select 1 from public.assignments where classroom_id=c)
    or exists(select 1 from public.tests where classroom_id=c) then raise exception 'Create did not produce a blank standalone item'; end if;
  perform public.mutate_gradebook_item(t,c,'create',i,'Attendance – Term 1',20,cat,10,true);
  if (select count(*) from public.gradebook_items where id=i) <> 1 then raise exception 'Create retry duplicated item'; end if;
  begin
    perform public.mutate_gradebook_item(t,c,'create',i,'Conflicting retry',20,cat,10,true);
    raise exception 'Conflicting retry accepted';
  exception when unique_violation then null; end;
  begin
    perform public.mutate_gradebook_item(s,c,'delete',i);
    raise exception 'Student mutation accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.mutate_gradebook_item(t,c,'update',i,'Wrong category',20,other_cat,10,true);
    raise exception 'Cross-class category accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.set_gradebook_item_score(t,c,i,t,5);
    raise exception 'Unenrolled score accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.set_gradebook_item_score(t,c,i,s,1.23);
    raise exception 'Score silently rounded';
  exception when invalid_parameter_value then null; end;
  r := public.set_gradebook_item_score(t,c,i,s,18.5);
  if r#>>'{score,earned}' <> '18.5' or r#>>'{score,returned_at}' is not null then raise exception 'Score leaked before return'; end if;
  if not exists(select 1 from public.student_purge_inventory_resources(c,s) where table_name='gradebook_item_scores')
    or exists(select 1 from public.student_purge_inventory_resources(c,s) where table_name='gradebook_items') then
    raise exception 'Student purge inventory must contain original scores and retain item definitions';
  end if;
  r := public.mutate_gradebook_item(t,c,'return_marks',i);
  if (r->>'returned_count')::int <> 1 then raise exception 'Return did not publish current scored rows'; end if;
  perform public.mutate_gradebook_item(t,c,'update',i,'Attendance – Term 1',20,cat,10,true);
  if (select returned_at from public.gradebook_item_scores where item_id=i) is null then raise exception 'No-op details retracted marks'; end if;
  perform public.mutate_gradebook_item(t,c,'update',i,'Attendance – Term 2',20,cat,10,true);
  if (select returned_at from public.gradebook_item_scores where item_id=i) is not null then raise exception 'Changed title retained disclosure'; end if;
  perform public.mutate_gradebook_item(t,c,'return_marks',i);
  perform public.mutate_gradebook_item(t,c,'weight',i,p_gradebook_weight=>25);
  if (select returned_at from public.gradebook_item_scores where item_id=i) is not null then raise exception 'Weight change retained disclosure'; end if;
  perform public.mutate_gradebook_item(t,c,'return_marks',i);
  -- Removing the selected category updates items through the FK, outside item RPCs.
  perform public.replace_gradebook_categories(c, (
    select jsonb_agg(to_jsonb(category) || jsonb_build_object('percentage',
      category.percentage + case when category.is_default then
        (select percentage from public.gradebook_categories where id=cat) else 0 end
    ) order by category.position)
    from public.gradebook_categories category where category.classroom_id=c and category.id<>cat
  ));
  if exists (
    select 1 from public.gradebook_item_scores score
    join public.gradebook_items item on item.id=score.item_id and item.classroom_id=score.classroom_id
    where score.classroom_id=c and score.student_id=s and score.returned_at is not null
  ) then raise exception 'Category removal retained student disclosure'; end if;
  if (select gradebook_category_id from public.gradebook_items where id=i) is not null then
    raise exception 'Deleted category was not cleared';
  end if;
  perform public.mutate_gradebook_item(t,c,'return_marks',i);
  if (select returned_at from public.gradebook_item_scores where item_id=i) is null then
    raise exception 'Uncategorized item could not be deliberately returned again';
  end if;
  select id into cat from public.gradebook_categories where classroom_id=c and is_default;
  perform public.mutate_gradebook_item(t,c,'update',i,'Attendance – Term 2',20,cat,25,true);
  perform public.mutate_gradebook_item(t,c,'return_marks',i);
  perform public.set_gradebook_item_score(t,c,i,s,19);
  if (select returned_at from public.gradebook_item_scores where item_id=i) is not null then raise exception 'Score edit retained disclosure'; end if;
  insert into public.gradebook_score_overrides(classroom_id,student_id,assessment_type,assessment_id,earned,created_by)
    values(c,s,'final',c,90,t);
  delete from public.gradebook_score_overrides where classroom_id=c;
  if not exists(select 1 from public.gradebook_item_scores where item_id=i and earned=19) then raise exception 'Undo overrides removed original score'; end if;
  perform public.set_gradebook_item_score(t,c,i,s,null);
  if exists(select 1 from public.gradebook_item_scores where item_id=i) then raise exception 'Clear did not remove score'; end if;
  perform public.set_gradebook_item_score(t,c,i,s,0);
  if not exists(select 1 from public.gradebook_item_scores where item_id=i and earned=0) then raise exception 'Zero was treated as blank'; end if;
  perform public.mutate_gradebook_item(t,c,'return_marks',i);
  update public.classrooms set archived_at=now() where id=c;
  begin
    perform public.set_gradebook_item_score(t,c,i,s,1);
    raise exception 'Archived score accepted';
  exception when object_not_in_prerequisite_state then null; end;
  begin
    perform public.mutate_gradebook_item(t,c,'delete',i);
    raise exception 'Archived item deletion accepted';
  exception when object_not_in_prerequisite_state then null; end;
  -- Actual hot-to-cold-to-hot archive RPCs preserve original marks and disclosure.
  select to_jsonb(item) into original_item from public.gradebook_items item where id=i;
  select to_jsonb(score) into original_score from public.gradebook_item_scores score where item_id=i;
  actors := jsonb_build_array(jsonb_build_object('actor_id',t,'role','teacher'),jsonb_build_object('actor_id',s,'role','student'));
  r := public.begin_classroom_archive_export_v2(export_id,t,c,repeat('a',64),'161_standalone_gradebook_items','abcdef1',
    '{"mode":"teacher_managed","delete_after":null}'::jsonb,2,2);
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'Standalone archive begin failed: %',r; end if;
  counts := r->'resource_counts';
  if counts->>'gradebook_items' <> '1' or counts->>'gradebook_item_scores' <> '1' then
    raise exception 'Standalone archive inventory omitted original rows: %',counts;
  end if;
  for resource in select * from public.classroom_archive_resource_contract_versions where format_version=2 order by export_position loop
    execute format('select coalesce(jsonb_agg(to_jsonb(source) order by source.%I),''[]''::jsonb) from public.%I source
      where public.resolve_classroom_archive_resource_classroom_id(%L,source.%I)=$1',
      resource.primary_key_columns[1],resource.table_name,resource.table_name,resource.primary_key_columns[1]) into rows_json using c;
    insert into standalone_archive_rows values(resource.table_name,rows_json);
  end loop;
  archive_path := format('%s/%s/%s/classroom-v2.tar.gz',t,c,export_id);
  if not public.stage_classroom_archive_object_upload(export_id,t,'classroom-archives',archive_path,repeat('b',64),1024) then
    raise exception 'Standalone archive staging failed';
  end if;
  r := public.complete_classroom_archive_export_v2(export_id,t,'classroom-archives',archive_path,repeat('b',64),repeat('c',64),1024,4096,
    counts,2,counts,'{"total_count":0,"total_bytes":0,"by_bucket":{}}'::jsonb,
    '{"read_back_verified":true,"artifact_checksum_verified":true,"manifest_verified":true,"resource_checksums_verified":true,
      "resource_counts_verified":true,"storage_objects_verified":true,"actor_snapshots_verified":true}'::jsonb);
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'Standalone archive finalize failed: %',r; end if;
  r := public.begin_classroom_archive_compaction_v2(compact_id,t,c,export_id,repeat('d',64),2);
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'Standalone compaction begin failed: %',r; end if;
  for resource in select * from standalone_archive_rows loop
    if jsonb_array_length(resource.rows)>0 then
      perform public.stage_classroom_archive_restore_rows(compact_id,t,resource.table_name,resource.rows);
    end if;
  end loop;
  perform public.stage_classroom_archive_compaction_objects(compact_id,t,'[]'::jsonb);
  verification := jsonb_build_object('operation_id',compact_id,'archive_id',export_id,'artifact_sha256',repeat('b',64),
    'content_sha256',repeat('c',64),'verified_at',clock_timestamp(),'read_back_verified',true,'artifact_checksum_verified',true,
    'manifest_verified',true,'resource_checksums_verified',true,'resource_counts_verified',true,'storage_objects_verified',true,
    'actor_snapshots_verified',true,'schema_adapter_verified',true,'actor_references_resolved',true,'source_object_cleanup_staged',true);
  r := public.complete_classroom_archive_compaction_v2(compact_id,t,actors,verification,2);
  if not coalesce((r->>'ok')::boolean,false) or exists(select 1 from public.gradebook_items where id=i)
    or exists(select 1 from public.gradebook_item_scores where item_id=i) then raise exception 'Standalone compaction failed: %',r; end if;
  r := public.begin_classroom_archive_restore_v2(restore_id,t,c,export_id,repeat('e',64),'161_standalone_gradebook_items',
    '[]'::jsonb,counts,'[]'::jsonb,2147483648,2,2,counts);
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'Standalone restore begin failed: %',r; end if;
  for resource in select * from standalone_archive_rows loop
    if jsonb_array_length(resource.rows)>0 then
      perform public.stage_classroom_archive_restore_rows_v2(restore_id,t,resource.table_name,resource.rows,2);
    end if;
  end loop;
  r := public.complete_classroom_archive_restore_v2(restore_id,t,
    '{"archive_checksum_verified":true,"manifest_verified":true,"resource_checksums_verified":true,"resource_counts_verified":true,
      "storage_objects_verified":true,"actor_snapshots_verified":true,"schema_adapter_available":true,"restored_storage_objects_verified":true,"adapter_chain":[]}'::jsonb,2);
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'Standalone restore finalize failed: %',r; end if;
  if (select to_jsonb(item) from public.gradebook_items item where id=i) is distinct from original_item
    or (select to_jsonb(score) from public.gradebook_item_scores score where item_id=i) is distinct from original_score then
    raise exception 'Archive roundtrip changed standalone item or original score';
  end if;
  update public.classrooms set archived_at=null where id=c;
  perform public.remove_classroom_roster_entries_atomic(c,array['e1610000-0000-4000-8000-000000000040'::uuid]);
  set constraints all immediate;
  if exists(select 1 from public.gradebook_item_scores where item_id=i)
    or not exists(select 1 from public.gradebook_items where id=i) then raise exception 'Roster cleanup did not retain item and remove original score'; end if;
  if (select revision from public.classroom_archive_revisions where classroom_id=c) <= rev then raise exception 'Gradebook did not bump archive revision'; end if;
  perform public.mutate_gradebook_item(t,c,'delete',i);
  if exists(select 1 from public.gradebook_items where id=i) then raise exception 'Delete failed'; end if;
  if (select count(*) from public.classroom_archive_resource_contract_versions where format_version=2 and table_name in ('gradebook_items','gradebook_item_scores')) <> 2
    or exists(select 1 from public.classroom_archive_resource_contract_versions where format_version=1 and table_name in ('gradebook_items','gradebook_item_scores')) then
    raise exception 'V2 archive extension changed immutable V1';
  end if;
  if not exists(select 1 from public.classroom_archive_resource_contract_versions where format_version=2 and table_name='gradebook_item_scores'
    and restore_after @> array['classroom_enrollments','gradebook_items']) then raise exception 'Score restore dependencies missing'; end if;
end;
$contract$;
rollback;
SQL
