#!/usr/bin/env bash
set -euo pipefail
# Rollback-only synthetic fixture; migration 209 requires separate application approval.
GRADEBOOK_MAX_DB_CONTAINER="supabase_db_pika"
PROJECT_LABEL="$(docker inspect "$GRADEBOOK_MAX_DB_CONTAINER" --format '{{ index .Config.Labels "com.supabase.cli.project" }}')"
DB_BINDING="$(docker port "$GRADEBOOK_MAX_DB_CONTAINER" 5432/tcp)"
if [[ "$PROJECT_LABEL" != "pika" || "$DB_BINDING" != *':54322'* ]]; then
  echo 'Refusing unexpected database target.' >&2
  exit 2
fi
docker exec -i "$GRADEBOOK_MAX_DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
begin;
do $$ begin
 if not exists(select 1 from supabase_migrations.schema_migrations where version='209') then
  raise exception 'Migration 209 requires separate local application approval';
 end if;
end $$;
insert into public.users(id,email,role) values
 ('20900000-0000-4000-8000-000000000001','maximum-teacher@example.test','teacher'),
 ('20900000-0000-4000-8000-000000000002','maximum-student@example.test','student');
insert into public.classrooms(id,teacher_id,title,class_code) values
 ('20900000-0000-4000-8000-000000000010','20900000-0000-4000-8000-000000000001','Maximum fixture','G20901');
insert into public.classroom_enrollments(classroom_id,student_id) values
 ('20900000-0000-4000-8000-000000000010','20900000-0000-4000-8000-000000000002');
insert into public.assignments(id,classroom_id,title,due_at,created_by,points_possible) values
 ('20900000-0000-4000-8000-000000000020','20900000-0000-4000-8000-000000000010','Maximum assignment',now()+interval '1 day','20900000-0000-4000-8000-000000000001',100);
insert into public.gradebook_items(id,classroom_id,title,points_possible,created_by) values
 ('20900000-0000-4000-8000-000000000030','20900000-0000-4000-8000-000000000010','Maximum item',100,'20900000-0000-4000-8000-000000000001');
insert into public.tests(id,classroom_id,title,created_by) values
 ('20900000-0000-4000-8000-000000000040','20900000-0000-4000-8000-000000000010','Maximum test','20900000-0000-4000-8000-000000000001');
insert into public.test_questions(test_id,question_text,question_type,points,"order") values
 ('20900000-0000-4000-8000-000000000040','Maximum question','open_response',100,0);

do $$
declare
 teacher uuid := '20900000-0000-4000-8000-000000000001'; student uuid := '20900000-0000-4000-8000-000000000002';
 classroom uuid := '20900000-0000-4000-8000-000000000010'; assignment uuid := '20900000-0000-4000-8000-000000000020';
 item uuid := '20900000-0000-4000-8000-000000000030'; test_id uuid := '20900000-0000-4000-8000-000000000040';
 n numeric;
begin
 perform public.set_gradebook_maximum_override(teacher,classroom,'assignment',assignment,50,'preserve_percentages',100,1);
 select gradebook_score_scale into n from public.assignments where id=assignment;
 if n <> 0.5 then raise exception 'Preserving percentages must scale earned marks'; end if;
 perform public.save_gradebook_effective_mark(teacher,classroom,'assignment',assignment,student,40.1);
 select earned into n from public.gradebook_score_overrides where assessment_id=assignment and student_id=student;
 if n <> 80.2 then raise exception 'Entered effective mark must normalize without losing fractions'; end if;
 perform public.set_gradebook_maximum_override(teacher,classroom,'assignment',assignment,25,'keep_marks',50,0.5);
 select gradebook_score_scale into n from public.assignments where id=assignment;
 if n <> 0.5 then raise exception 'Keeping marks must retain the current scale'; end if;
 begin
  perform public.set_gradebook_maximum_override(teacher,classroom,'assignment',assignment,10,'keep_marks',100,1);
  raise exception 'Stale maximum accepted';
 exception when serialization_failure then null; end;
 perform public.set_gradebook_maximum_override(teacher,classroom,'assignment',assignment,null,'reset',25,0.5);
 if exists(select 1 from public.assignments where id=assignment and (gradebook_maximum_override is not null or gradebook_score_scale<>1)) then raise exception 'Reset failed'; end if;
 update public.assignments set points_possible=3 where id=assignment;
 perform public.set_gradebook_maximum_override(teacher,classroom,'assignment',assignment,1,'preserve_percentages',3,1);
 perform public.set_gradebook_maximum_override(teacher,classroom,'assignment',assignment,2,'preserve_percentages',1,0.3333333333333333);
 perform public.set_gradebook_maximum_override(teacher,classroom,'item',item,50,'preserve_percentages',100,1);
 perform public.save_gradebook_effective_mark(teacher,classroom,'item',item,student,0);
 select earned into n from public.gradebook_item_scores where item_id=item and student_id=student;
 if n <> 0 then raise exception 'Zero lost'; end if;
 perform public.save_gradebook_effective_mark(teacher,classroom,'item',item,student,null);
 if exists(select 1 from public.gradebook_item_scores where item_id=item) then raise exception 'Clear failed'; end if;
 perform public.set_gradebook_maximum_override(teacher,classroom,'test',test_id,50,'preserve_percentages',100,1);
 select gradebook_score_scale into n from public.tests where id=test_id;
 if n <> 0.5 then raise exception 'Test maximum failed'; end if;
 begin
  perform public.set_gradebook_maximum_override(student,classroom,'test',test_id,25,'keep_marks',50,0.5);
  raise exception 'Non-owner accepted';
 exception when insufficient_privilege then null; end;
 update public.classrooms set archived_at=now() where id=classroom;
 begin
  perform public.save_gradebook_effective_mark(teacher,classroom,'test',test_id,student,40);
  raise exception 'Archived classroom accepted';
 exception when object_not_in_prerequisite_state then null; end;
 if has_function_privilege('anon','public.set_gradebook_maximum_override(uuid,uuid,text,uuid,numeric,text,numeric,numeric)','execute')
  or has_function_privilege('authenticated','public.read_gradebook_maximum_state(uuid)','execute') then raise exception 'Browser RPC privileges leaked'; end if;
end $$;
rollback;
SQL
