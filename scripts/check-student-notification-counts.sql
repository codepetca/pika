-- Run against the disposable database after replaying migration 331.
\set ON_ERROR_STOP on
begin;
set local statement_timeout = '30s';

do $contract$
declare
  owner_id uuid := 'a3310000-0000-4000-8000-000000000001';
  member_id uuid := 'a3310000-0000-4000-8000-000000000002';
  peer_id uuid := 'a3310000-0000-4000-8000-000000000003';
  class_id uuid := 'a3310000-0000-4000-8000-000000000010';
  other_class_id uuid := 'a3310000-0000-4000-8000-000000000011';
  returned_assignment uuid := 'a3310000-0000-4000-8000-000000000020';
  seen_assignment uuid := 'a3310000-0000-4000-8000-000000000021';
  reopened_test uuid := 'a3310000-0000-4000-8000-000000000030';
  disabled_test uuid := 'a3310000-0000-4000-8000-000000000031';
  whitespace_test uuid := 'a3310000-0000-4000-8000-000000000032';
  answered_test uuid := 'a3310000-0000-4000-8000-000000000033';
  locked_test uuid := 'a3310000-0000-4000-8000-000000000034';
  read_announcement uuid := 'a3310000-0000-4000-8000-000000000040';
  unread_announcement uuid := 'a3310000-0000-4000-8000-000000000041';
  whitespace_question uuid := 'a3310000-0000-4000-8000-000000000050';
  answered_question uuid := 'a3310000-0000-4000-8000-000000000051';
  today date := (statement_timestamp() at time zone 'America/Toronto')::date;
  cutoff timestamptz := date_trunc('milliseconds', statement_timestamp());
  signature text := 'public.read_student_notification_counts_v1(uuid,uuid)';
  result jsonb;
begin
  if has_function_privilege('anon', signature, 'execute')
    or has_function_privilege('authenticated', signature, 'execute')
    or not has_function_privilege('service_role', signature, 'execute') then
    raise exception 'Notification counts must be executable only by the server';
  end if;

  insert into public.users(id, email, role) values
    (owner_id, 'badge-owner@example.test', 'teacher'),
    (member_id, 'badge-member@example.test', 'teacher'),
    (peer_id, 'badge-peer@example.test', 'student');

  insert into public.classrooms(id, teacher_id, title, class_code) values
    (class_id, owner_id, 'Notification contract', 'NOTIFY31'),
    (other_class_id, owner_id, 'Other classroom', 'OTHER331');
  insert into public.classroom_enrollments(classroom_id, student_id) values
    (class_id, member_id), (class_id, owner_id);
  insert into public.class_days(classroom_id, date, is_class_day) values
    (class_id, today, true);
  insert into public.entries(classroom_id, student_id, date, text, on_time) values
    (class_id, owner_id, today, 'Classmate entry', true),
    (other_class_id, member_id, today, 'Other classroom entry', true);

  insert into public.assignments(id, classroom_id, title, due_at, created_by, is_draft, released_at) values
    (returned_assignment, class_id, 'Returned feedback', now(), owner_id, false, cutoff),
    (seen_assignment, class_id, 'Seen at same time', now(), owner_id, false, null),
    (gen_random_uuid(), class_id, 'Draft', now(), owner_id, true, null),
    (gen_random_uuid(), class_id, 'Scheduled', now(), owner_id, false, cutoff + interval '1 day'),
    (gen_random_uuid(), other_class_id, 'Other classroom', now(), owner_id, false, null);
  insert into public.assignment_docs(assignment_id, student_id, viewed_at, feedback_returned_at) values
    (returned_assignment, member_id, cutoff - interval '1 day', cutoff),
    (seen_assignment, member_id, cutoff, cutoff);
  insert into public.assignments(classroom_id, title, due_at, created_by, is_draft)
    select class_id, 'Unseen assignment ' || n, now(), owner_id, false
    from generate_series(1, 1001) n;

  insert into public.tests(id, classroom_id, title, status, points_possible, created_by) values
    (reopened_test, class_id, 'Reopened for learner', 'closed', 1, owner_id),
    (disabled_test, class_id, 'Closed for learner', 'draft', 1, owner_id),
    (whitespace_test, class_id, 'Whitespace only', 'draft', 1, owner_id),
    (answered_test, class_id, 'Answered', 'draft', 1, owner_id),
    (locked_test, class_id, 'Locked for grading', 'closed', 1, owner_id);
  insert into public.test_questions(id, test_id, question_type, question_text, points, position) values
    (whitespace_question, whitespace_test, 'open_response', 'Write an answer', 1, 0),
    (answered_question, answered_test, 'open_response', 'Write an answer', 1, 0);
  -- Give the active-but-overridden test a valid question for publication.
  insert into public.test_questions(test_id, question_type, question_text, points, position) values
    (disabled_test, 'open_response', 'Write an answer', 1, 0);
  update public.tests set status = 'active' where id in (disabled_test, whitespace_test, answered_test);
  insert into public.test_student_availability(test_id, student_id, state, updated_by) values
    (reopened_test, member_id, 'open', owner_id),
    (disabled_test, member_id, 'closed', owner_id),
    (locked_test, member_id, 'open', owner_id);
  insert into public.test_responses(test_id, question_id, student_id, response_text) values
    (whitespace_test, whitespace_question, member_id, U&'\0009\00A0\FEFF'),
    (answered_test, answered_question, member_id, 'An answer');
  insert into public.test_attempts(test_id, student_id, responses, closed_for_grading_at) values
    (locked_test, member_id, '{}', cutoff);

  insert into public.announcements(id, classroom_id, content, created_by, is_draft, scheduled_for, published_at) values
    (read_announcement, class_id, 'Read', owner_id, false, null, cutoff),
    (unread_announcement, class_id, 'Unread', owner_id, false, cutoff, cutoff),
    (gen_random_uuid(), class_id, 'Draft', owner_id, true, null, null),
    (gen_random_uuid(), class_id, 'Scheduled', owner_id, false, cutoff + interval '1 day', cutoff + interval '1 day'),
    (gen_random_uuid(), other_class_id, 'Other classroom', owner_id, false, null, cutoff);
  insert into public.announcement_reads(announcement_id, user_id) values
    (read_announcement, member_id), (unread_announcement, owner_id);

  set local role service_role;
  result := public.read_student_notification_counts_v1(member_id, class_id);
  if result is distinct from '{"ok":true,"hasTodayEntry":false,"unviewedAssignmentsCount":1002,"activeTestsCount":2,"unreadAnnouncementsCount":1}'::jsonb then
    raise exception 'Incorrect notification state: %', result;
  end if;
  if public.read_student_notification_counts_v1(owner_id, class_id) is distinct from '{"ok":false,"status":403}'::jsonb
    or public.read_student_notification_counts_v1(peer_id, class_id) is distinct from '{"ok":false,"status":403}'::jsonb
    or public.read_student_notification_counts_v1(member_id, gen_random_uuid()) is distinct from '{"ok":false,"status":404}'::jsonb then
    raise exception 'Unexpected classroom access result';
  end if;
  reset role;

  -- Observe each override independently so opposite counting mistakes cannot cancel.
  delete from public.test_student_availability where test_id = reopened_test and student_id = member_id;
  result := public.read_student_notification_counts_v1(member_id, class_id);
  if result -> 'activeTestsCount' is distinct from '1'::jsonb then
    raise exception 'Reopened test override was not counted independently: %', result;
  end if;
  insert into public.test_student_availability(test_id, student_id, state, updated_by)
    values (reopened_test, member_id, 'open', owner_id);
  delete from public.test_student_availability where test_id = disabled_test and student_id = member_id;
  result := public.read_student_notification_counts_v1(member_id, class_id);
  if result -> 'activeTestsCount' is distinct from '3'::jsonb then
    raise exception 'Individually closed test override was not counted independently: %', result;
  end if;
  insert into public.test_student_availability(test_id, student_id, state, updated_by)
    values (disabled_test, member_id, 'closed', owner_id);

  insert into public.entries(classroom_id, student_id, date, text, on_time)
    values (class_id, member_id, today, 'Own Daily entry', true);
  set local role service_role;
  result := public.read_student_notification_counts_v1(member_id, class_id);
  if result -> 'hasTodayEntry' is distinct from 'true'::jsonb then
    raise exception 'Own entry on the active class day did not clear the reminder';
  end if;
  reset role;
  delete from public.entries where classroom_id = class_id and student_id = member_id and date = today;

  update public.class_days set is_class_day = false where classroom_id = class_id and date = today;
  update public.classrooms set feature_visibility = feature_visibility
    || '{"classwork":false,"tests":false,"announcements":false}'::jsonb where id = class_id;
  result := public.read_student_notification_counts_v1(member_id, class_id);
  if result is distinct from '{"ok":true,"hasTodayEntry":true,"unviewedAssignmentsCount":0,"activeTestsCount":0,"unreadAnnouncementsCount":0}'::jsonb then
    raise exception 'Hidden features or non-class day changed: %', result;
  end if;

  update public.classrooms set feature_visibility = feature_visibility || '{"unknown":"bad"}'::jsonb
    where id = class_id;
  if public.read_student_notification_counts_v1(member_id, class_id) is distinct from '{"ok":false,"status":503}'::jsonb then
    raise exception 'Malformed visibility did not fail closed';
  end if;

  update public.classrooms set archived_at = now() where id = class_id;
  if public.read_student_notification_counts_v1(member_id, class_id) is distinct from '{"ok":false,"status":403}'::jsonb then
    raise exception 'Archived classroom returned notification state';
  end if;
end;
$contract$;

rollback;
