-- Freeze the retired Quiz source contract and preserve every remaining row in
-- the generic retired-assessment envelope introduced by migration 105.
--
-- Rollout guard: do not apply this migration until the application uses the
-- version-aware archive runtime. Backfilled envelopes intentionally make the
-- legacy v1 export/compaction entry points fail closed.

begin;

set local timezone = 'UTC';
set local lock_timeout = '5s';

create or replace function private.legacy_quiz_deterministic_uuid_v1(
  p_parts text[]
)
returns uuid
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_input bytea := ''::bytea;
  v_digest bytea;
  v_part text;
  v_index integer := 0;
  v_hex text;
begin
  foreach v_part in array p_parts
  loop
    if v_part is null then
      raise exception 'Deterministic UUID parts cannot be null'
        using errcode = '22004';
    end if;
    if v_index > 0 then
      v_input := v_input || decode('00', 'hex');
    end if;
    v_input := v_input || convert_to(v_part, 'UTF8');
    v_index := v_index + 1;
  end loop;

  v_digest := extensions.digest(v_input, 'sha256');
  v_digest := set_byte(v_digest, 6, (get_byte(v_digest, 6) & 15) | 128);
  v_digest := set_byte(v_digest, 8, (get_byte(v_digest, 8) & 63) | 128);
  v_hex := encode(substring(v_digest from 1 for 16), 'hex');

  return (
    substring(v_hex from 1 for 8) || '-' ||
    substring(v_hex from 9 for 4) || '-' ||
    substring(v_hex from 13 for 4) || '-' ||
    substring(v_hex from 17 for 4) || '-' ||
    substring(v_hex from 21 for 12)
  )::uuid;
end;
$$;

create or replace function private.legacy_quiz_json_number_v1(
  p_value jsonb
)
returns text
language plpgsql
immutable
strict
set search_path = ''
set extra_float_digits = 3
as $$
declare
  v_number double precision;
  v_text text;
begin
  if jsonb_typeof(p_value) <> 'number' then
    raise exception 'Canonical JSON number input must be numeric'
      using errcode = '22023';
  end if;

  v_number := (p_value #>> '{}')::double precision;
  if v_number = 0 then
    return '0';
  end if;

  v_text := v_number::text;
  if abs(v_number) >= 1e21::double precision
    or abs(v_number) < 1e-6::double precision
  then
    if position('e' in v_text) = 0 then
      raise exception 'Cannot encode legacy Quiz payload number canonically: %', v_text
        using errcode = '22023';
    end if;
    return regexp_replace(v_text, 'e([+-])0+([0-9]+)$', 'e\1\2');
  end if;

  if position('e' in v_text) > 0 then
    return trim_scale(v_text::numeric)::text;
  end if;
  return v_text;
end;
$$;

create or replace function private.legacy_quiz_json_object_index_v1(
  p_key text
)
returns numeric
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_index numeric;
begin
  if p_key !~ '^(0|[1-9][0-9]{0,9})$' then
    return null;
  end if;
  v_index := p_key::numeric;
  if v_index > 4294967294 then
    return null;
  end if;
  return v_index;
end;
$$;

create or replace function private.legacy_quiz_canonical_json_v1(
  p_value jsonb
)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_result text;
begin
  case jsonb_typeof(p_value)
    when 'object' then
      select '{' || coalesce(
        string_agg(
          to_jsonb(entry.key)::text || ':' ||
            private.legacy_quiz_canonical_json_v1(entry.value),
          ','
          order by
            case
              when private.legacy_quiz_json_object_index_v1(entry.key) is not null then 0
              else 1
            end,
            private.legacy_quiz_json_object_index_v1(entry.key),
            convert_to(entry.key, 'UTF8')
        ),
        ''
      ) || '}'
      into v_result
      from jsonb_each(p_value) entry;
      return v_result;
    when 'array' then
      select '[' || coalesce(
        string_agg(
          private.legacy_quiz_canonical_json_v1(item.value),
          ','
          order by item.ordinality
        ),
        ''
      ) || ']'
      into v_result
      from jsonb_array_elements(p_value) with ordinality item(value, ordinality);
      return v_result;
    when 'number' then
      return private.legacy_quiz_json_number_v1(p_value);
    when 'string' then
      return p_value::text;
    when 'boolean' then
      return p_value::text;
    when 'null' then
      return 'null';
    else
      raise exception 'Unsupported JSON value in legacy Quiz payload'
        using errcode = '22023';
  end case;
end;
$$;

create or replace function private.legacy_quiz_payload_sha256_v1(
  p_payload jsonb
)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(private.legacy_quiz_canonical_json_v1(p_payload), 'UTF8'),
      'sha256'
    ),
    'hex'
  );
$$;

create table private.legacy_quiz_backfill_ledger (
  backfill_id uuid not null,
  migration_name text not null,
  source_contract text not null,
  source_contract_version integer not null,
  source_resource text not null,
  source_count bigint not null check (source_count >= 0),
  envelope_count bigint not null check (envelope_count >= 0),
  source_aggregate_sha256 text not null check (
    source_aggregate_sha256 ~ '^[a-f0-9]{64}$'
  ),
  envelope_aggregate_sha256 text not null check (
    envelope_aggregate_sha256 ~ '^[a-f0-9]{64}$'
  ),
  applied_at timestamptz not null default transaction_timestamp(),
  primary key (backfill_id, source_resource),
  unique (migration_name, source_resource),
  check (source_count = envelope_count),
  check (source_aggregate_sha256 = envelope_aggregate_sha256)
);

revoke all on table private.legacy_quiz_backfill_ledger
  from public, anon, authenticated, service_role;

comment on table private.legacy_quiz_backfill_ledger is
  'Aggregate-only parity evidence for the one-time legacy Quiz envelope backfill.';

create or replace function private.reject_legacy_quiz_source_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'assessment_drafts' and tg_op <> 'TRUNCATE' then
    if tg_op = 'INSERT' and new.assessment_type <> 'quiz' then
      return new;
    end if;
    if tg_op = 'UPDATE'
      and old.assessment_type <> 'quiz'
      and new.assessment_type <> 'quiz'
    then
      return new;
    end if;
    if tg_op = 'DELETE' and old.assessment_type <> 'quiz' then
      return old;
    end if;
  end if;

  raise exception 'Legacy Quiz source is frozen: %.% %',
    tg_table_schema, tg_table_name, tg_op
    using errcode = '0A000';
end;
$$;

-- Acquire relations in archive traversal order and fail immediately when any
-- live transaction conflicts. Retrying a rolled-back migration during a quiet
-- window is safer than joining an archive/source lock cycle.
lock table
  public.classroom_retired_assessment_records,
  public.classroom_retired_assessment_record_actors,
  public.assessment_drafts,
  public.quizzes,
  public.quiz_questions,
  public.quiz_student_scores,
  public.quiz_responses,
  public.course_blueprint_assessments
in access exclusive mode nowait;

-- The source rows already contribute to the classroom revision. Moving their
-- representation into envelopes must not bump that revision or take revision
-- row locks in the opposite order from an in-flight archive snapshot.
select set_config('pika.classroom_archive_compaction', 'on', true);

do $blueprint_preflight$
begin
  if exists (
    select 1
    from public.course_blueprint_assessments
    where assessment_type = 'quiz'
  ) then
    raise exception 'Legacy Quiz blueprint rows must be zero before retirement'
      using errcode = '23514';
  end if;
end;
$blueprint_preflight$;

alter table public.course_blueprint_assessments
  drop constraint course_blueprint_assessments_assessment_type_check;
alter table public.course_blueprint_assessments
  add constraint course_blueprint_assessments_assessment_type_check
    check (assessment_type = 'test');

create trigger freeze_legacy_quizzes
before insert or update or delete on public.quizzes
for each row execute function private.reject_legacy_quiz_source_write();
create trigger freeze_legacy_quiz_questions
before insert or update or delete on public.quiz_questions
for each row execute function private.reject_legacy_quiz_source_write();
create trigger freeze_legacy_quiz_responses
before insert or update or delete on public.quiz_responses
for each row execute function private.reject_legacy_quiz_source_write();
create trigger freeze_legacy_quiz_student_scores
before insert or update or delete on public.quiz_student_scores
for each row execute function private.reject_legacy_quiz_source_write();
create trigger freeze_legacy_quiz_drafts
before insert or update or delete on public.assessment_drafts
for each row execute function private.reject_legacy_quiz_source_write();

create trigger freeze_legacy_quizzes_truncate
before truncate on public.quizzes
for each statement execute function private.reject_legacy_quiz_source_write();
create trigger freeze_legacy_quiz_questions_truncate
before truncate on public.quiz_questions
for each statement execute function private.reject_legacy_quiz_source_write();
create trigger freeze_legacy_quiz_responses_truncate
before truncate on public.quiz_responses
for each statement execute function private.reject_legacy_quiz_source_write();
create trigger freeze_legacy_quiz_student_scores_truncate
before truncate on public.quiz_student_scores
for each statement execute function private.reject_legacy_quiz_source_write();
create trigger freeze_legacy_quiz_drafts_truncate
before truncate on public.assessment_drafts
for each statement execute function private.reject_legacy_quiz_source_write();

do $source_preflight$
begin
  if exists (
    select 1
    from public.quiz_questions question
    left join public.quizzes quiz on quiz.id = question.quiz_id
    where quiz.id is null
  ) then
    raise exception 'Legacy Quiz question has no parent Quiz'
      using errcode = '23503';
  end if;

  if exists (
    select 1
    from public.quiz_responses response
    left join public.quiz_questions question on question.id = response.question_id
    left join public.quizzes quiz on quiz.id = response.quiz_id
    where question.id is null
      or quiz.id is null
      or question.quiz_id <> response.quiz_id
  ) then
    raise exception 'Legacy Quiz response has an invalid parent graph'
      using errcode = '23503';
  end if;

  if exists (
    select 1
    from public.quiz_student_scores score
    left join public.quizzes quiz on quiz.id = score.quiz_id
    where quiz.id is null
  ) then
    raise exception 'Legacy Quiz score has no parent Quiz'
      using errcode = '23503';
  end if;

  if exists (
    select 1
    from public.assessment_drafts draft
    left join public.quizzes quiz on quiz.id = draft.assessment_id
    where draft.assessment_type = 'quiz'
      and (
        quiz.id is null
        or quiz.classroom_id <> draft.classroom_id
      )
  ) then
    raise exception 'Legacy Quiz draft has an invalid parent Quiz'
      using errcode = '23503';
  end if;
end;
$source_preflight$;

create temporary table legacy_quiz_expected_records (
  id uuid not null,
  classroom_id uuid not null,
  source_contract text not null,
  source_contract_version integer not null,
  source_resource text not null,
  source_row_id uuid not null,
  parent_source_resource text,
  parent_source_row_id uuid,
  payload jsonb not null,
  payload_sha256 text not null,
  checksum_algorithm text not null,
  source_created_at timestamptz,
  source_updated_at timestamptz
) on commit drop;

insert into legacy_quiz_expected_records
select
  private.legacy_quiz_deterministic_uuid_v1(array[
    'pika.classroom-archive@1/legacy-quiz',
    quiz.classroom_id::text,
    'quizzes',
    quiz.id::text
  ]),
  quiz.classroom_id,
  'pika.classroom-archive@1/legacy-quiz',
  1,
  'quizzes',
  quiz.id,
  null,
  null,
  to_jsonb(quiz),
  private.legacy_quiz_payload_sha256_v1(to_jsonb(quiz)),
  'sha256-canonical-json-v1',
  quiz.created_at,
  quiz.updated_at
from public.quizzes quiz
union all
select
  private.legacy_quiz_deterministic_uuid_v1(array[
    'pika.classroom-archive@1/legacy-quiz',
    quiz.classroom_id::text,
    'quiz_questions',
    question.id::text
  ]),
  quiz.classroom_id,
  'pika.classroom-archive@1/legacy-quiz',
  1,
  'quiz_questions',
  question.id,
  'quizzes',
  question.quiz_id,
  to_jsonb(question),
  private.legacy_quiz_payload_sha256_v1(to_jsonb(question)),
  'sha256-canonical-json-v1',
  question.created_at,
  question.updated_at
from public.quiz_questions question
join public.quizzes quiz on quiz.id = question.quiz_id
union all
select
  private.legacy_quiz_deterministic_uuid_v1(array[
    'pika.classroom-archive@1/legacy-quiz',
    quiz.classroom_id::text,
    'quiz_responses',
    response.id::text
  ]),
  quiz.classroom_id,
  'pika.classroom-archive@1/legacy-quiz',
  1,
  'quiz_responses',
  response.id,
  'quiz_questions',
  response.question_id,
  to_jsonb(response),
  private.legacy_quiz_payload_sha256_v1(to_jsonb(response)),
  'sha256-canonical-json-v1',
  null,
  null
from public.quiz_responses response
join public.quizzes quiz on quiz.id = response.quiz_id
union all
select
  private.legacy_quiz_deterministic_uuid_v1(array[
    'pika.classroom-archive@1/legacy-quiz',
    quiz.classroom_id::text,
    'quiz_student_scores',
    score.id::text
  ]),
  quiz.classroom_id,
  'pika.classroom-archive@1/legacy-quiz',
  1,
  'quiz_student_scores',
  score.id,
  'quizzes',
  score.quiz_id,
  to_jsonb(score),
  private.legacy_quiz_payload_sha256_v1(to_jsonb(score)),
  'sha256-canonical-json-v1',
  score.created_at,
  score.updated_at
from public.quiz_student_scores score
join public.quizzes quiz on quiz.id = score.quiz_id
union all
select
  private.legacy_quiz_deterministic_uuid_v1(array[
    'pika.classroom-archive@1/legacy-quiz',
    draft.classroom_id::text,
    'assessment_drafts',
    draft.id::text
  ]),
  draft.classroom_id,
  'pika.classroom-archive@1/legacy-quiz',
  1,
  'assessment_drafts',
  draft.id,
  'quizzes',
  draft.assessment_id,
  to_jsonb(draft),
  private.legacy_quiz_payload_sha256_v1(to_jsonb(draft)),
  'sha256-canonical-json-v1',
  draft.created_at,
  draft.updated_at
from public.assessment_drafts draft
where draft.assessment_type = 'quiz';

do $record_collision_preflight$
begin
  if exists (
    select 1
    from legacy_quiz_expected_records
    group by id
    having count(*) > 1
  ) then
    raise exception 'Legacy Quiz deterministic record UUID collision'
      using errcode = '23505';
  end if;

  if exists (
    select 1
    from legacy_quiz_expected_records expected
    join public.classroom_retired_assessment_records existing
      on existing.id = expected.id
      or (
        existing.classroom_id = expected.classroom_id
        and existing.source_contract = expected.source_contract
        and existing.source_contract_version = expected.source_contract_version
        and existing.source_resource = expected.source_resource
        and existing.source_row_id = expected.source_row_id
      )
  ) then
    raise exception 'Legacy Quiz retired-assessment record collision'
      using errcode = '23505';
  end if;
end;
$record_collision_preflight$;

create temporary table legacy_quiz_expected_actors (
  id uuid not null,
  record_id uuid not null,
  actor_id uuid not null,
  source_column text not null
) on commit drop;

insert into legacy_quiz_expected_actors
select
  private.legacy_quiz_deterministic_uuid_v1(array[
    record.id::text,
    actor.source_column,
    actor.actor_id
  ]),
  record.id,
  actor.actor_id::uuid,
  actor.source_column
from legacy_quiz_expected_records record
cross join lateral (
  select 'created_by'::text, record.payload->>'created_by'
  where record.source_resource = 'quizzes'
  union all
  select 'student_id', record.payload->>'student_id'
  where record.source_resource in ('quiz_responses', 'quiz_student_scores')
  union all
  select 'created_by', record.payload->>'created_by'
  where record.source_resource = 'assessment_drafts'
  union all
  select 'updated_by', record.payload->>'updated_by'
  where record.source_resource = 'assessment_drafts'
) actor(source_column, actor_id);

do $actor_preflight$
begin
  if exists (
    select 1
    from legacy_quiz_expected_actors
    group by id
    having count(*) > 1
  ) then
    raise exception 'Legacy Quiz deterministic actor UUID collision'
      using errcode = '23505';
  end if;

  if exists (
    select 1
    from legacy_quiz_expected_actors expected
    left join public.users actor on actor.id = expected.actor_id
    where actor.id is null
  ) then
    raise exception 'Legacy Quiz envelope actor cannot be resolved'
      using errcode = '23503';
  end if;

  if exists (
    select 1
    from legacy_quiz_expected_actors expected
    join public.classroom_retired_assessment_record_actors existing
      on existing.id = expected.id
  ) then
    raise exception 'Legacy Quiz retired-assessment actor collision'
      using errcode = '23505';
  end if;
end;
$actor_preflight$;

insert into public.classroom_retired_assessment_records (
  id,
  classroom_id,
  source_contract,
  source_contract_version,
  source_resource,
  source_row_id,
  parent_source_resource,
  parent_source_row_id,
  payload,
  payload_sha256,
  checksum_algorithm,
  source_created_at,
  source_updated_at
)
select
  id,
  classroom_id,
  source_contract,
  source_contract_version,
  source_resource,
  source_row_id,
  parent_source_resource,
  parent_source_row_id,
  payload,
  payload_sha256,
  checksum_algorithm,
  source_created_at,
  source_updated_at
from legacy_quiz_expected_records
order by source_resource, source_row_id;

insert into public.classroom_retired_assessment_record_actors (
  id,
  record_id,
  actor_id,
  source_column
)
select id, record_id, actor_id, source_column
from legacy_quiz_expected_actors
order by id;

insert into private.legacy_quiz_backfill_ledger (
  backfill_id,
  migration_name,
  source_contract,
  source_contract_version,
  source_resource,
  source_count,
  envelope_count,
  source_aggregate_sha256,
  envelope_aggregate_sha256
)
with resources(source_resource) as (
  values
    ('quizzes'::text),
    ('quiz_questions'),
    ('quiz_responses'),
    ('quiz_student_scores'),
    ('assessment_drafts')
),
source_summary as (
  select
    source_resource,
    count(*)::bigint as row_count,
    encode(
      extensions.digest(
        convert_to(
          coalesce(
            string_agg(
              source_row_id::text || ':' || payload_sha256,
              E'\n'
              order by source_row_id::text
            ),
            ''
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ) as aggregate_sha256
  from legacy_quiz_expected_records
  group by source_resource
),
envelope_summary as (
  select
    source_resource,
    count(*)::bigint as row_count,
    encode(
      extensions.digest(
        convert_to(
          coalesce(
            string_agg(
              source_row_id::text || ':' || payload_sha256,
              E'\n'
              order by source_row_id::text
            ),
            ''
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ) as aggregate_sha256
  from public.classroom_retired_assessment_records
  where source_contract = 'pika.classroom-archive@1/legacy-quiz'
    and source_contract_version = 1
  group by source_resource
)
select
  '10600000-0000-8000-8000-000000000001'::uuid,
  '106_freeze_and_backfill_legacy_quiz',
  'pika.classroom-archive@1/legacy-quiz',
  1,
  resource.source_resource,
  coalesce(source.row_count, 0),
  coalesce(envelope.row_count, 0),
  coalesce(
    source.aggregate_sha256,
    encode(extensions.digest(''::bytea, 'sha256'), 'hex')
  ),
  coalesce(
    envelope.aggregate_sha256,
    encode(extensions.digest(''::bytea, 'sha256'), 'hex')
  )
from resources resource
left join source_summary source using (source_resource)
left join envelope_summary envelope using (source_resource)
order by resource.source_resource;

do $parity_postflight$
begin
  if (
    select count(*)
    from private.legacy_quiz_backfill_ledger
    where backfill_id = '10600000-0000-8000-8000-000000000001'::uuid
  ) <> 5 then
    raise exception 'Legacy Quiz backfill ledger is incomplete'
      using errcode = '23514';
  end if;

  if (
    select count(*)
    from legacy_quiz_expected_records
  ) <> (
    select count(*)
    from public.classroom_retired_assessment_records
    where source_contract = 'pika.classroom-archive@1/legacy-quiz'
      and source_contract_version = 1
  ) then
    raise exception 'Legacy Quiz source and envelope counts differ'
      using errcode = '23514';
  end if;

  if (
    select count(*)
    from legacy_quiz_expected_actors
  ) <> (
    select count(*)
    from public.classroom_retired_assessment_record_actors actor
    join public.classroom_retired_assessment_records record
      on record.id = actor.record_id
    where record.source_contract = 'pika.classroom-archive@1/legacy-quiz'
      and record.source_contract_version = 1
  ) then
    raise exception 'Legacy Quiz actor source and envelope counts differ'
      using errcode = '23514';
  end if;
end;
$parity_postflight$;

commit;
