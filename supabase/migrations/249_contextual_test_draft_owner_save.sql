-- Dormant contextual owner Test draft PATCH. Admission is an application gate.
-- 247 and134 are immutable. Both endpoints use247's parent order and134 is
-- the only writer. Clock checks are permission-to-commit fences, not physical
-- cancellation of an already-running outer statement.
begin;

create function private.test_draft_save_owner_source_v1(
  p_actor_id uuid, p_test_id uuid, p_fixed_classroom_id uuid,
  p_deadline timestamptz, p_phase_deadline timestamptz
)
returns jsonb language plpgsql set search_path = '' as $function$
declare
  v_source jsonb;
  v_test public.tests%rowtype;
begin
  if p_deadline > pg_catalog.clock_timestamp() + interval '20 seconds' then
    raise exception using errcode = 'PT400', message = 'test_draft_invalid_input';
  end if;
  v_source := private.test_draft_owner_source_v1(
    p_actor_id, p_test_id, p_fixed_classroom_id, p_deadline, p_phase_deadline);
  select test.* into strict v_test from public.tests test where test.id = p_test_id;
  if v_test.blueprint_archived_at is not null then
    raise exception using errcode = 'PT403', message = 'test_draft_retired';
  end if;
  if pg_catalog.octet_length(coalesce(v_test.documents, 'null'::jsonb)::text) > 2097152 then
    raise exception using errcode = 'PT503', message = 'test_draft_source_limit';
  end if;
  v_source := (v_source - 'source_sha256') || pg_catalog.jsonb_build_object('test',
    (v_source->'test') || pg_catalog.jsonb_build_object(
      'documents', v_test.documents, 'updated_at', v_test.updated_at));
  v_source := v_source || pg_catalog.jsonb_build_object('source_sha256',
    pg_catalog.encode(extensions.digest(v_source::text, 'sha256'), 'hex'));
  if pg_catalog.octet_length(v_source::text) > 8388608 then
    raise exception using errcode = 'PT503', message = 'test_draft_source_limit';
  end if;
  if pg_catalog.clock_timestamp() >= least(p_deadline, p_phase_deadline) then
    raise exception using errcode = 'PT503', message = 'test_draft_deadline';
  end if;
  return v_source;
end;
$function$;
revoke all on function private.test_draft_save_owner_source_v1(uuid,uuid,uuid,timestamptz,timestamptz) from public, anon, authenticated, service_role;

-- Independent canonical transport/content defense. No defaults, coercion,
-- unknown question fields, nonportable/duplicate IDs or fractional integers.
create function private.validate_test_draft_save_content_v1(p_content jsonb, p_allow_empty boolean)
returns void language plpgsql set search_path = '' as $function$
declare
  v_question jsonb;
  v_question_id uuid;
  v_seen_ids uuid[] := array[]::uuid[];
  v_option jsonb;
  v_key text;
  v_grading_text text;
  v_trim_chars text := U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
begin
  if p_content is null or pg_catalog.jsonb_typeof(p_content) is distinct from 'object'
    or pg_catalog.octet_length(p_content::text) > 2097152 then
    raise exception using errcode = 'PT400', message = 'test_draft_invalid_content';
  end if;
  if pg_catalog.jsonb_typeof(p_content->'title') is distinct from 'string'
    or nullif(pg_catalog.btrim(p_content->>'title'), '') is null
    or pg_catalog.jsonb_typeof(p_content->'show_results') is distinct from 'boolean'
    or pg_catalog.jsonb_typeof(p_content->'questions') is distinct from 'array'
    or p_content->'question_identity_version' is distinct from '1'::jsonb
    or exists (select 1 from pg_catalog.jsonb_object_keys(p_content) keys(key)
      where key not in ('title','show_results','questions','question_identity_version','source_format','source_markdown'))
    or (p_content ? 'source_format' and p_content->'source_format' is distinct from '"markdown"'::jsonb)
    or (p_content ? 'source_markdown' and pg_catalog.jsonb_typeof(p_content->'source_markdown') is distinct from 'string') then
    raise exception using errcode = 'PT400', message = 'test_draft_invalid_content';
  end if;
  if pg_catalog.jsonb_array_length(p_content->'questions') > 10000
    or (not p_allow_empty and pg_catalog.jsonb_array_length(p_content->'questions') = 0) then
    raise exception using errcode = 'PT400', message = 'test_draft_invalid_content';
  end if;
  for v_question in select value from pg_catalog.jsonb_array_elements(p_content->'questions') loop
    if pg_catalog.jsonb_typeof(v_question) is distinct from 'object' then
      raise exception using errcode = 'PT400', message = 'test_draft_invalid_content';
    end if;
    if not v_question ?& array['id','question_type','question_text','options','correct_option','answer_key',
      'sample_solution','points','response_max_chars','response_monospace']
      or exists (select 1 from pg_catalog.jsonb_object_keys(v_question) keys(key)
        where key not in ('id','question_type','question_text','options','correct_option','answer_key',
          'sample_solution','points','response_max_chars','response_monospace'))
      or pg_catalog.jsonb_typeof(v_question->'id') is distinct from 'string'
      or (v_question->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or pg_catalog.jsonb_typeof(v_question->'question_text') is distinct from 'string'
      or (not p_allow_empty and nullif(pg_catalog.btrim(v_question->>'question_text'), '') is null)
      or pg_catalog.jsonb_typeof(v_question->'question_type') is distinct from 'string'
      or (v_question->>'question_type') not in ('multiple_choice','open_response')
      or pg_catalog.jsonb_typeof(v_question->'options') is distinct from 'array'
      or pg_catalog.jsonb_typeof(v_question->'points') is distinct from 'number'
      or pg_catalog.jsonb_typeof(v_question->'response_max_chars') is distinct from 'number'
      or pg_catalog.jsonb_typeof(v_question->'response_monospace') is distinct from 'boolean'
      or pg_catalog.jsonb_typeof(v_question->'answer_key') not in ('string','null')
      or pg_catalog.jsonb_typeof(v_question->'sample_solution') not in ('string','null') then
      raise exception using errcode = 'PT400', message = 'test_draft_invalid_content';
    end if;
    v_question_id := (v_question->>'id')::uuid;
    if v_question_id = any(v_seen_ids) then
      raise exception using errcode = 'PT400', message = 'test_draft_invalid_content';
    end if;
    v_seen_ids := pg_catalog.array_append(v_seen_ids, v_question_id);
    -- The canonical decoder rejects explicit empty grading strings and trims
    -- the complete JavaScript whitespace set. Require its final value here:
    -- 134 must not materialize NULL/trimmed text while Draft retains raw text.
    foreach v_key in array array['answer_key','sample_solution'] loop
      if pg_catalog.jsonb_typeof(v_question->v_key)='string' then
        v_grading_text:=pg_catalog.btrim(v_question->>v_key,v_trim_chars);
        if v_grading_text='' or v_grading_text is distinct from v_question->>v_key then
          raise exception using errcode = 'PT400', message = 'test_draft_invalid_content';
        end if;
      end if;
    end loop;
    if (v_question->>'points')::numeric <= 0 or (v_question->>'points')::numeric > 9999.99
      or (v_question->>'points')::numeric <> pg_catalog.round((v_question->>'points')::numeric, 2)
      or (v_question->>'response_max_chars')::numeric not between 1 and 20000
      or (v_question->>'response_max_chars')::numeric <> pg_catalog.trunc((v_question->>'response_max_chars')::numeric)
      or pg_catalog.char_length(v_question->>'answer_key') > 20000
      or pg_catalog.char_length(v_question->>'sample_solution') > 20000 then
      raise exception using errcode = 'PT400', message = 'test_draft_invalid_content';
    end if;
    if v_question->>'question_type' = 'multiple_choice' then
      if pg_catalog.jsonb_array_length(v_question->'options') not between 2 and 6
        or pg_catalog.jsonb_typeof(v_question->'correct_option') is distinct from 'number' then
        raise exception using errcode = 'PT400', message = 'test_draft_invalid_content';
      end if;
      if (v_question->>'correct_option')::numeric <> pg_catalog.trunc((v_question->>'correct_option')::numeric)
        or (v_question->>'correct_option')::numeric not between 0 and pg_catalog.jsonb_array_length(v_question->'options') - 1
        or v_question->'answer_key' <> 'null'::jsonb or v_question->'sample_solution' <> 'null'::jsonb
        or v_question->'response_monospace' <> 'false'::jsonb then
        raise exception using errcode = 'PT400', message = 'test_draft_invalid_content';
      end if;
      for v_option in select value from pg_catalog.jsonb_array_elements(v_question->'options') loop
        if pg_catalog.jsonb_typeof(v_option) is distinct from 'string' or nullif(pg_catalog.btrim(v_option #>> '{}'), '') is null then
          raise exception using errcode = 'PT400', message = 'test_draft_invalid_content';
        end if;
      end loop;
    elsif v_question->'options' <> '[]'::jsonb or v_question->'correct_option' <> 'null'::jsonb then
      raise exception using errcode = 'PT400', message = 'test_draft_invalid_content';
    end if;
  end loop;
end;
$function$;
revoke all on function private.validate_test_draft_save_content_v1(jsonb,boolean) from public, anon, authenticated, service_role;

-- GET's legacy numeric defaults use JavaScript Number(), not the new strict
-- candidate decoder. Reproduce finite scalar/single-element-array coercion;
-- arrays with a comma, object coercion and nonfinite numbers are invalid.
create function private.test_draft_save_baseline_number_v1(p_value jsonb)
returns double precision language plpgsql set search_path = '' as $function$
declare
  v_value jsonb := p_value;
  v_array boolean := false;
  v_depth integer := 0;
  v_text text;
  v_number double precision;
  v_base integer;
  v_digit integer;
  v_accumulator numeric := 0;
  v_position integer;
  v_trim_chars text := U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
begin
  while pg_catalog.jsonb_typeof(v_value)='array' loop
    v_array:=true; v_depth:=v_depth+1;
    if v_depth>64 or pg_catalog.jsonb_array_length(v_value)>1 then return null; end if;
    if pg_catalog.jsonb_array_length(v_value)=0 then return 0; end if;
    v_value:=v_value->0;
  end loop;
  if v_value is null or v_value='null'::jsonb then return 0; end if;
  if pg_catalog.jsonb_typeof(v_value)='boolean' then
    if v_array then return null; end if;
    return case when v_value='true'::jsonb then 1 else 0 end;
  end if;
  if pg_catalog.jsonb_typeof(v_value) not in ('string','number') then return null; end if;
  v_text:=pg_catalog.btrim(v_value #>> '{}',v_trim_chars);
  if v_text='' then return 0; end if;
  if v_text ~ '^0[xX][0-9a-fA-F]+$' then v_base:=16;
  elsif v_text ~ '^0[oO][0-7]+$' then v_base:=8;
  elsif v_text ~ '^0[bB][01]+$' then v_base:=2;
  elsif v_text !~ '^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]+)?$' then return null;
  end if;
  if v_base is not null then
    for v_position in 3..pg_catalog.char_length(v_text) loop
      v_digit:=pg_catalog.strpos('0123456789abcdef',pg_catalog.lower(pg_catalog.substr(v_text,v_position,1)))-1;
      v_accumulator:=v_accumulator*v_base+v_digit;
      if v_accumulator>1.7976931348623157e308::numeric then return null; end if;
    end loop;
    v_number:=v_accumulator::double precision;
  else
    v_number:=v_text::double precision;
  end if;
  if v_number in ('Infinity'::double precision,'-Infinity'::double precision,'NaN'::double precision) then return null; end if;
  return v_number;
exception when invalid_text_representation or numeric_value_out_of_range then return null;
end;
$function$;
revoke all on function private.test_draft_save_baseline_number_v1(jsonb) from public, anon, authenticated, service_role;

-- This predicate matches validateTestDraftContent(requiredPortable marker1)
-- for stored draft-status baselines. GET accepts ignored top/question fields,
-- missing optional defaults, numeric coercion and type-specific normalization;
-- reloading those valid rows must not cause a permanent repair loop. It does
-- not canonicalize or rewrite the raw baseline that participates in source CAS.
create function private.test_draft_save_baseline_valid_v1(p_content jsonb)
returns boolean language plpgsql set search_path = '' as $function$
declare
  v_question jsonb;
  v_question_id uuid;
  v_seen_ids uuid[] := array[]::uuid[];
  v_open boolean;
  v_number double precision;
  v_options_count integer;
  v_option jsonb;
  v_key text;
  v_text text;
  v_trim_chars text := U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
begin
  if p_content is null or pg_catalog.jsonb_typeof(p_content) is distinct from 'object'
    or pg_catalog.octet_length(p_content::text)>2097152
    or p_content->'question_identity_version' is distinct from '1'::jsonb
    or pg_catalog.jsonb_typeof(p_content->'title') is distinct from 'string'
    or nullif(pg_catalog.btrim(p_content->>'title',v_trim_chars),'') is null
    or pg_catalog.jsonb_typeof(p_content->'show_results') is distinct from 'boolean'
    or pg_catalog.jsonb_typeof(p_content->'questions') is distinct from 'array' then return false; end if;
  if pg_catalog.jsonb_array_length(p_content->'questions')>10000 then return false; end if;
  for v_question in select value from pg_catalog.jsonb_array_elements(p_content->'questions') loop
    if pg_catalog.jsonb_typeof(v_question) is distinct from 'object'
      or pg_catalog.jsonb_typeof(v_question->'id') is distinct from 'string'
      or (v_question->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or pg_catalog.jsonb_typeof(v_question->'question_text') is distinct from 'string' then return false; end if;
    v_question_id:=(v_question->>'id')::uuid;
    if v_question_id=any(v_seen_ids) then return false; end if;
    v_seen_ids:=pg_catalog.array_append(v_seen_ids,v_question_id);
    v_open:=coalesce(v_question->>'question_type' = 'open_response',false);
    if v_question->'points' is null or v_question->'points' = 'null'::jsonb or v_question->'points'='""'::jsonb then
      v_number:=case when v_open then 5 else 1 end;
    else v_number:=private.test_draft_save_baseline_number_v1(v_question->'points'); end if;
    if v_number is null or v_number<=0 then return false; end if;
    if v_question->'response_max_chars' is null or v_question->'response_max_chars' = 'null'::jsonb
      or v_question->'response_max_chars'='""'::jsonb then v_number:=5000;
    else v_number:=private.test_draft_save_baseline_number_v1(v_question->'response_max_chars'); end if;
    if v_number is null or v_number not between 1 and 20000 or v_number<>pg_catalog.trunc(v_number) then return false; end if;
    if v_open then
      -- Open response ignores options/correct_option and defaults an absent or
      -- nonboolean monospace flag. Optional teacher fields alone are decoded.
      foreach v_key in array array['answer_key','sample_solution'] loop
        if v_question->v_key is not null and v_question->v_key<>'null'::jsonb then
          if pg_catalog.jsonb_typeof(v_question->v_key) is distinct from 'string' then return false; end if;
          v_text:=pg_catalog.btrim(v_question->>v_key,v_trim_chars);
          if v_text='' or pg_catalog.char_length(v_text)>20000 then return false; end if;
        end if;
      end loop;
    else
      -- MC ignores teacher-key/sample/monospace extras, but its marked choice
      -- must be an actual numeric integer; Number() coercion does not apply.
      if pg_catalog.jsonb_typeof(v_question->'options') is distinct from 'array'
        or pg_catalog.jsonb_typeof(v_question->'correct_option') is distinct from 'number' then return false; end if;
      v_options_count:=pg_catalog.jsonb_array_length(v_question->'options');
      v_number:=private.test_draft_save_baseline_number_v1(v_question->'correct_option');
      if v_options_count not between 2 and 6 or v_number is null
        or v_number not between 0 and v_options_count-1 or v_number<>pg_catalog.trunc(v_number) then return false; end if;
      for v_option in select value from pg_catalog.jsonb_array_elements(v_question->'options') loop
        if pg_catalog.jsonb_typeof(v_option) is distinct from 'string'
          or nullif(pg_catalog.btrim(v_option #>> '{}',v_trim_chars),'') is null then return false; end if;
      end loop;
    end if;
  end loop;
  return true;
end;
$function$;
revoke all on function private.test_draft_save_baseline_valid_v1(jsonb) from public, anon, authenticated, service_role;

-- Snapshot fields are server authority. Strip and reattach only an exact
-- (id,source,url) baseline, including its raw managed identity and MIME stamp.
create function private.test_draft_save_documents_v1(p_documents jsonb, p_current jsonb)
returns jsonb language plpgsql set search_path = '' as $function$
declare
  v_document jsonb;
  v_previous jsonb;
  v_result jsonb := '[]'::jsonb;
  v_seen text[] := array[]::text[];
begin
  if p_documents is null or pg_catalog.jsonb_typeof(p_documents) is distinct from 'array'
    or pg_catalog.octet_length(p_documents::text) > 2097152 then
    raise exception using errcode = 'PT400', message = 'test_draft_invalid_documents';
  end if;
  if pg_catalog.jsonb_array_length(p_documents) > 20 then
    raise exception using errcode = 'PT400', message = 'test_draft_invalid_documents';
  end if;
  for v_document in select value from pg_catalog.jsonb_array_elements(p_documents) loop
    if pg_catalog.jsonb_typeof(v_document) is distinct from 'object' then
      raise exception using errcode = 'PT400', message = 'test_draft_invalid_documents';
    end if;
    if pg_catalog.jsonb_typeof(v_document->'id') is distinct from 'string'
      or nullif(pg_catalog.btrim(v_document->>'id'), '') is null
      or pg_catalog.char_length(v_document->>'id') > 4096
      or pg_catalog.jsonb_typeof(v_document->'title') is distinct from 'string'
      or nullif(pg_catalog.btrim(v_document->>'title'), '') is null
      or pg_catalog.char_length(v_document->>'title') > 120
      or pg_catalog.jsonb_typeof(v_document->'source') is distinct from 'string'
      or (v_document->>'source') not in ('link','upload','text')
      or (v_document->>'id') = any(v_seen)
      or exists (select 1 from pg_catalog.jsonb_object_keys(v_document) keys(key)
        where key not in ('id','title','source','url','storage_bucket','storage_path','managed_object_id',
          'upload_content_type','content','snapshot_path','snapshot_managed_object_id','snapshot_content_type','synced_at')) then
      raise exception using errcode = 'PT400', message = 'test_draft_invalid_documents';
    end if;
    v_seen := pg_catalog.array_append(v_seen, v_document->>'id');
    v_document := v_document - array['snapshot_path','snapshot_managed_object_id','snapshot_content_type','synced_at'];
    if v_document->>'source' = 'link' then
      if pg_catalog.jsonb_typeof(v_document->'url') is distinct from 'string'
        or pg_catalog.char_length(v_document->>'url') > 4096
        or (v_document->>'url') !~ '^https?://[^[:space:]/]+'
        or exists (select 1 from pg_catalog.jsonb_object_keys(v_document) keys(key)
          where key not in ('id','title','source','url')) then
        raise exception using errcode = 'PT400', message = 'test_draft_invalid_documents';
      end if;
      select document.value into v_previous from pg_catalog.jsonb_array_elements(coalesce(p_current,'[]'::jsonb)) document(value)
        where document.value->>'id' = v_document->>'id' and document.value->>'source' = 'link'
          and document.value->>'url' = v_document->>'url';
      if found and nullif(v_previous->>'snapshot_path','') is not null then
        v_document := v_document || (select coalesce(pg_catalog.jsonb_object_agg(key,value),'{}'::jsonb)
          from pg_catalog.jsonb_each(v_previous) where key in ('snapshot_path','snapshot_managed_object_id','snapshot_content_type','synced_at'));
      end if;
    elsif v_document->>'source' = 'text' then
      if pg_catalog.jsonb_typeof(v_document->'content') is distinct from 'string'
        or nullif(pg_catalog.btrim(v_document->>'content'),'') is null
        or pg_catalog.char_length(v_document->>'content') > 20000
        or exists (select 1 from pg_catalog.jsonb_object_keys(v_document) keys(key)
          where key not in ('id','title','source','content')) then
        raise exception using errcode = 'PT400', message = 'test_draft_invalid_documents';
      end if;
    else
      if v_document->'storage_bucket' is distinct from '"test-documents"'::jsonb
        or pg_catalog.jsonb_typeof(v_document->'storage_path') is distinct from 'string'
        or nullif(v_document->>'storage_path','') is null or (v_document->>'storage_path') like '/%'
        or pg_catalog.char_length(v_document->>'storage_path') > 4096
        or pg_catalog.strpos(v_document->>'storage_path', E'\\') > 0
        or exists (select 1 from pg_catalog.unnest(pg_catalog.string_to_array(v_document->>'storage_path','/')) segment
          where segment in ('','.','..'))
        or exists (select 1 from pg_catalog.jsonb_object_keys(v_document) keys(key)
          where key not in ('id','title','source','url','storage_bucket','storage_path','managed_object_id','upload_content_type'))
        or (v_document ? 'managed_object_id' and (pg_catalog.jsonb_typeof(v_document->'managed_object_id') is distinct from 'string'
          or (v_document->>'managed_object_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) then
        raise exception using errcode = 'PT400', message = 'test_draft_invalid_documents';
      end if;
      -- Retain a supplied upload URL representation.117 independently checks
      -- every managed URL reference against the explicit bucket/path/identity;
      -- accepting this bounded string never confers object authority.
      if v_document ? 'url' and (pg_catalog.jsonb_typeof(v_document->'url') is distinct from 'string'
        or pg_catalog.char_length(v_document->>'url')>4096 or (v_document->>'url') !~ '^https?://[^[:space:]/]+') then
        raise exception using errcode = 'PT400', message = 'test_draft_invalid_documents';
      end if;
      if v_document ? 'upload_content_type' and (pg_catalog.jsonb_typeof(v_document->'upload_content_type') is distinct from 'string'
        or (v_document->>'upload_content_type') not in ('application/pdf','text/plain','text/markdown','text/csv',
          'application/json','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/png','image/jpeg')) then
        raise exception using errcode = 'PT400', message = 'test_draft_invalid_documents';
      end if;
      if not v_document ? 'managed_object_id' and not exists (
        select 1 from pg_catalog.jsonb_array_elements(coalesce(p_current,'[]'::jsonb)) document(value)
        where document.value->>'source' = 'upload' and document.value->>'id' = v_document->>'id'
          and document.value->>'storage_path' = v_document->>'storage_path'
          and not document.value ? 'managed_object_id') then
        raise exception using errcode = 'PT400', message = 'test_draft_invalid_documents';
      end if;
    end if;
    v_result := v_result || pg_catalog.jsonb_build_array(v_document);
  end loop;
  return v_result;
end;
$function$;
revoke all on function private.test_draft_save_documents_v1(jsonb,jsonb) from public, anon, authenticated, service_role;

-- Bound whole target rows before aggregation. Operational question columns are
-- included here for postconditions, but remain excluded from the authored CAS.
create function private.test_draft_save_state_v1(p_test_id uuid)
returns jsonb language plpgsql set search_path = '' as $function$
declare
  v_bytes bigint;
  v_questions jsonb;
  v_work jsonb;
begin
  select coalesce(sum(pg_catalog.octet_length(bounded.value::text)),0) into v_bytes from (
    select pg_catalog.to_jsonb(question) value from public.test_questions question where question.test_id=p_test_id
    union all select pg_catalog.to_jsonb(attempt) from public.test_attempts attempt where attempt.test_id=p_test_id
    union all select pg_catalog.to_jsonb(response) from public.test_responses response where response.test_id=p_test_id
    union all select pg_catalog.to_jsonb(availability) from public.test_student_availability availability where availability.test_id=p_test_id
    union all select pg_catalog.to_jsonb(history) from public.test_attempt_history history
      join public.test_attempts attempt on attempt.id=history.test_attempt_id where attempt.test_id=p_test_id
  ) bounded;
  if v_bytes > 67108864 then
    raise exception using errcode='PT503',message='test_draft_source_limit';
  end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(question) order by question.position,question.id),'[]'::jsonb)
    into v_questions from public.test_questions question where question.test_id=p_test_id;
  select coalesce(pg_catalog.jsonb_agg(bounded.value order by bounded.kind,bounded.id),'[]'::jsonb) into v_work from (
    select 'attempt' kind, attempt.id, pg_catalog.jsonb_build_object('kind','attempt','row',pg_catalog.to_jsonb(attempt)) value
      from public.test_attempts attempt where attempt.test_id=p_test_id
    union all select 'response',response.id,pg_catalog.jsonb_build_object('kind','response','row',pg_catalog.to_jsonb(response))
      from public.test_responses response where response.test_id=p_test_id
    union all select 'availability',availability.id,pg_catalog.jsonb_build_object('kind','availability','row',pg_catalog.to_jsonb(availability))
      from public.test_student_availability availability where availability.test_id=p_test_id
    union all select 'history',history.id,pg_catalog.jsonb_build_object('kind','history','row',pg_catalog.to_jsonb(history))
      from public.test_attempt_history history join public.test_attempts attempt on attempt.id=history.test_attempt_id where attempt.test_id=p_test_id
  ) bounded;
  return pg_catalog.jsonb_build_object('questions',v_questions,'student_work',v_work);
end;
$function$;
revoke all on function private.test_draft_save_state_v1(uuid) from public, anon, authenticated, service_role;

create function public.snapshot_test_draft_save_for_owner_v1(p_actor_id uuid,p_test_id uuid,p_deadline timestamptz)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '1s' as $function$
declare
  v_phase_deadline timestamptz := least(p_deadline, pg_catalog.clock_timestamp() + interval '8 seconds');
  v_source jsonb;
begin
  v_source := private.test_draft_save_owner_source_v1(p_actor_id,p_test_id,null,p_deadline,v_phase_deadline);
  if pg_catalog.clock_timestamp() >= v_phase_deadline then
    raise exception using errcode='PT503',message='test_draft_deadline';
  end if;
  return v_source;
exception
  when sqlstate '40P01' or sqlstate '55P03' or sqlstate '40001' or sqlstate '23505' then
    raise exception using errcode='PT409',message='test_draft_busy';
  when sqlstate '55000' then
    if sqlerrm in ('classroom_purge_active','attendance_decommission_active') then
      raise exception using errcode='PT403',message='test_draft_fenced';
    else raise; end if;
end;
$function$;
revoke all on function public.snapshot_test_draft_save_for_owner_v1(uuid,uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.snapshot_test_draft_save_for_owner_v1(uuid,uuid,timestamptz) to service_role;

create function public.finish_test_draft_save_for_owner_v1(
  p_actor_id uuid,p_test_id uuid,p_classroom_id uuid,p_expected_source_sha256 text,
  p_expected_version integer,p_operation text,p_content jsonb,p_documents jsonb,
  p_update_documents boolean,p_deadline timestamptz
)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '1s' as $function$
declare
  v_phase_deadline timestamptz := least(p_deadline, pg_catalog.clock_timestamp() + interval '8 seconds');
  v_source jsonb;
  v_source_after jsonb;
  v_result jsonb;
  v_inner_result jsonb;
  v_before public.assessment_drafts%rowtype;
  v_expected public.assessment_drafts%rowtype;
  v_after public.assessment_drafts%rowtype;
  v_test public.tests%rowtype;
  v_test_expected public.tests%rowtype;
  v_test_after public.tests%rowtype;
  v_classroom public.classrooms%rowtype;
  v_classroom_expected public.classrooms%rowtype;
  v_classroom_after public.classrooms%rowtype;
  v_blueprint_before bigint;
  v_archive_before bigint;
  v_archive_after bigint;
  v_state_before jsonb;
  v_state_after jsonb;
  v_questions_before_map jsonb;
  v_questions_after_map jsonb;
  v_documents jsonb;
  v_question jsonb;
  v_old_question jsonb;
  v_actual_question jsonb;
  v_expected_question jsonb;
  v_expected_questions jsonb := '[]'::jsonb;
  v_question_mutations integer := 0;
  v_test_changed integer := 0;
  v_position integer := 0;
  v_matched_count bigint;
  v_object public.managed_storage_objects%rowtype;
  v_object_after public.managed_storage_objects%rowtype;
  v_objects_before jsonb := '[]'::jsonb;
  v_object_ids uuid[] := array[]::uuid[];
  v_reference_ids uuid[] := array[]::uuid[];
  v_reference_row_ids uuid[] := array[]::uuid[];
  v_paths text[] := array[]::text[];
  v_path record;
  v_refs_expected jsonb;
  v_refs_actual jsonb;
  v_evidence text;
  v_queue_before jsonb;
  v_queue_after jsonb;
  v_queue_expected jsonb;
  v_queue_row jsonb;
  v_removed_snapshot jsonb;
  v_write_started timestamptz;
  v_effect_time timestamptz;
  v_bytes bigint;
begin
  if p_classroom_id is null or p_expected_source_sha256 is null
    or p_expected_source_sha256 !~ '^[a-f0-9]{64}$'
    or p_operation is null or p_operation not in ('inspect', 'save')
    or p_update_documents is null or (p_expected_version is not null and p_expected_version < 1) then
    raise exception using errcode='PT400',message='test_draft_invalid_input';
  end if;
  v_source := private.test_draft_save_owner_source_v1(p_actor_id,p_test_id,p_classroom_id,p_deadline,v_phase_deadline);
  if v_source->>'source_sha256' is distinct from p_expected_source_sha256 then
    raise exception using errcode='PT409',message='test_draft_source_changed';
  end if;
  select test.* into strict v_test from public.tests test where test.id=p_test_id and test.classroom_id=p_classroom_id;
  if v_source->'draft' <> 'null'::jsonb then
    v_before := pg_catalog.jsonb_populate_record(null::public.assessment_drafts,v_source->'draft');
    if v_before.classroom_id is distinct from p_classroom_id then
      raise exception using errcode='PT503',message='test_draft_invalid_source';
    end if;
    if p_expected_version is null or v_before.version is distinct from p_expected_version then
      raise exception using errcode='PT409',message='test_draft_source_changed';
    end if;
  elsif p_expected_version is not null then
    raise exception using errcode='PT409',message='test_draft_source_changed';
  end if;
  if p_operation = 'save' and v_source->'draft' = 'null'::jsonb then
    raise exception using errcode='PT409',message='test_draft_reload_required';
  end if;
  if p_operation='inspect' and p_content is not null and v_source->'draft'='null'::jsonb then
    raise exception using errcode='PT400',message='test_draft_invalid_input';
  end if;
  if p_content is not null then
    perform private.validate_test_draft_save_content_v1(p_content,v_test.status='draft');
  elsif p_operation='save' then
    raise exception using errcode='PT400',message='test_draft_invalid_content';
  end if;
  -- GET owns repairs. Stored legacy normalization remains compatible while
  -- the new candidate independently passes the strict canonical validator.
  if p_operation='save' and v_test.status='draft' then
    if not private.test_draft_save_baseline_valid_v1(v_before.content) then
      raise exception using errcode='PT409',message='test_draft_reload_required';
    end if;
  end if;
  if p_operation='inspect' then
    v_result := pg_catalog.jsonb_build_object('version',1,'actor_id',p_actor_id,'classroom_id',p_classroom_id,
      'test_id',p_test_id,'operation',p_operation,'draft',case when p_content is null then 'null'::jsonb
        else (v_source->'draft') || pg_catalog.jsonb_build_object('content',p_content) end,
      'test',v_source->'test','editingPolicy',pg_catalog.jsonb_build_object('structureLocked',v_test.questions_locked_at is not null));
    if pg_catalog.octet_length(v_result::text)>8388608 or pg_catalog.clock_timestamp() >= v_phase_deadline then
      raise exception using errcode='PT503',message='test_draft_deadline';
    end if;
    return v_result;
  end if;
  if v_before.version = 2147483647 then
    raise exception using errcode='PT503',message='test_draft_version_limit';
  end if;
  if v_before.updated_at > pg_catalog.transaction_timestamp()
    or v_test.updated_at > pg_catalog.transaction_timestamp() then
    raise exception using errcode='PT503',message='test_draft_invalid_source';
  end if;
  v_documents := case when p_update_documents then private.test_draft_save_documents_v1(p_documents,v_test.documents)
    else v_test.documents end;
  if pg_catalog.jsonb_typeof(coalesce(v_documents,'[]'::jsonb)) is distinct from 'array'
    or pg_catalog.jsonb_array_length(coalesce(v_documents,'[]'::jsonb))>20 then
    raise exception using errcode='PT503',message='test_draft_invalid_source';
  end if;
  -- 220 freezes settings, identity, order and grading; word/one-choice text
  -- corrections are checked by the authoritative child trigger as well.
  if v_test.questions_locked_at is not null and (
    v_test.title is distinct from pg_catalog.btrim(p_content->>'title')
    or v_test.show_results is distinct from (p_content->>'show_results')::boolean
    or v_test.documents is distinct from v_documents) then
    raise exception using errcode='PT409',
      message = 'test_questions_locked: Only question wording and existing choice text can change after a student starts';
  end if;
  v_state_before := private.test_draft_save_state_v1(p_test_id);
  select coalesce(pg_catalog.jsonb_object_agg(coalesce(question.value->>'source_artifact_id',question.value->>'artifact_id'),question.value),'{}'::jsonb)
    into v_questions_before_map from pg_catalog.jsonb_array_elements(v_state_before->'questions') question(value);
  if exists (select 1 from pg_catalog.jsonb_array_elements(v_state_before->'questions') question(value)
    where coalesce(question.value->>'source_artifact_id',question.value->>'artifact_id') is null)
    or pg_catalog.jsonb_array_length(v_state_before->'questions') <> (
      select count(*) from pg_catalog.jsonb_object_keys(v_questions_before_map)) then
    raise exception using errcode='PT503',message='test_draft_invalid_source';
  end if;
  if exists (select 1 from pg_catalog.jsonb_array_elements(p_content->'questions') candidate(value)
    join pg_catalog.jsonb_array_elements(v_state_before->'questions') question(value)
      on question.value->>'id'=candidate.value->>'id'
    where coalesce(question.value->>'source_artifact_id',question.value->>'artifact_id') is distinct from candidate.value->>'id') then
    raise exception using errcode='PT409',message='test_draft_identity_conflict';
  end if;
  select classroom.* into strict v_classroom from public.classrooms classroom where classroom.id=p_classroom_id;
  v_classroom_expected:=v_classroom;
  v_blueprint_before:=v_classroom.blueprint_source_revision;
  select revision.revision into strict v_archive_before from public.classroom_archive_revisions revision where revision.classroom_id=p_classroom_id;
  v_expected:=v_before;
  v_expected.content:=p_content;
  v_expected.version:=v_before.version+1;
  v_expected.updated_by:=p_actor_id;
  v_expected.updated_at:=pg_catalog.transaction_timestamp();
  v_test_expected:=v_test;
  v_test_expected.title:=pg_catalog.btrim(p_content->>'title');
  v_test_expected.show_results:=(p_content->>'show_results')::boolean;
  v_test_expected.documents:=v_documents;
  v_test_expected.updated_at:=pg_catalog.transaction_timestamp();
  v_test_changed:=case when v_test.title is distinct from v_test_expected.title
    or v_test.show_results is distinct from v_test_expected.show_results
    or v_test.documents is distinct from v_test_expected.documents then 1 else 0 end;

  -- Protocol -> sorted managed UUIDs -> exact paths. Pre-DML try/NOWAIT
  -- locks preserve117/245's global order and never advance its sequence here.
  perform 1 from public.managed_storage_settings settings where settings.singleton for share nowait;
  if not found then raise exception using errcode='PT503',message='test_draft_invalid_source'; end if;
  perform 1 from public.managed_storage_json_references reference where reference.test_id=p_test_id order by reference.id for update nowait;
  select coalesce(pg_catalog.array_agg(distinct reference.managed_object_id),array[]::uuid[])
    into v_reference_ids from public.managed_storage_json_references reference where reference.test_id=p_test_id;
  select coalesce(pg_catalog.array_agg(reference.id),array[]::uuid[])
    into v_reference_row_ids from public.managed_storage_json_references reference where reference.test_id=p_test_id;
  select coalesce(sum(pg_catalog.octet_length(pg_catalog.to_jsonb(object)::text)),0) into v_bytes
    from public.managed_storage_objects object where object.id=any(v_reference_ids)
      or object.id in (select managed_object_id from public.managed_storage_payload_ids(v_documents)
        union select managed_object_id from public.managed_storage_payload_ids(v_test.documents))
      or exists (select 1 from public.managed_storage_payload_raw_references(v_documents || coalesce(v_test.documents,'[]'::jsonb)) reference
        where reference.storage_bucket=object.storage_bucket and reference.storage_path=object.storage_path);
  if v_bytes + pg_catalog.octet_length(v_state_before::text) + pg_catalog.octet_length(v_questions_before_map::text)
    + pg_catalog.octet_length(v_source::text) + pg_catalog.octet_length(p_content::text)
    + pg_catalog.octet_length(coalesce(v_documents,'null'::jsonb)::text)>67108864 then
    raise exception using errcode='PT503',message='test_draft_source_limit';
  end if;
  for v_object in select object.* from public.managed_storage_objects object where object.id=any(v_reference_ids)
    or object.id in (select managed_object_id from public.managed_storage_payload_ids(v_documents)
      union select managed_object_id from public.managed_storage_payload_ids(v_test.documents))
    or exists (select 1 from public.managed_storage_payload_raw_references(v_documents || coalesce(v_test.documents,'[]'::jsonb)) reference
      where reference.storage_bucket=object.storage_bucket and reference.storage_path=object.storage_path)
    order by object.id for update nowait loop
    v_object_ids:=pg_catalog.array_append(v_object_ids,v_object.id);
    v_objects_before:=v_objects_before || pg_catalog.jsonb_build_array(pg_catalog.to_jsonb(v_object));
  end loop;
  for v_question in select value from pg_catalog.jsonb_array_elements(coalesce(v_documents,'[]'::jsonb))
    where value->>'source'='upload' and value ? 'managed_object_id' and value ? 'upload_content_type' loop
    select object.* into v_object from public.managed_storage_objects object where object.id=(v_question->>'managed_object_id')::uuid;
    if not found or v_object.content_type is distinct from v_question->>'upload_content_type' then
      raise exception using errcode='PT400',message='test_draft_invalid_documents';
    end if;
  end loop;
  for v_path in select distinct reference.storage_bucket,reference.storage_path
    from public.managed_storage_payload_raw_references(v_documents || coalesce(v_test.documents,'[]'::jsonb)) reference
    union select object.storage_bucket,object.storage_path from public.managed_storage_objects object where object.id=any(v_object_ids)
    order by 1,2 loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(
      pg_catalog.jsonb_build_array(v_path.storage_bucket,v_path.storage_path)::text,0)) then
      raise exception using errcode='PT409',message='test_draft_busy';
    end if;
    if exists (select 1 from public.managed_storage_objects object where object.storage_bucket=v_path.storage_bucket
      and object.storage_path=v_path.storage_path and not object.id=any(v_object_ids)) then
      raise exception using errcode='PT409',message='test_draft_source_changed';
    end if;
  end loop;
  -- Explicit identities (including snapshots) must resolve exactly; Class
  -- binding permits already-authorized same-Class reuse without a same-Test rule.
  for v_question in select distinct pg_catalog.to_jsonb(reference) from public.managed_storage_payload_raw_references(v_documents) reference loop
    if v_question->>'managed_object_id' is not null then
      select object.* into v_object from public.managed_storage_objects object where object.id=(v_question->>'managed_object_id')::uuid;
      if not found or v_object.classroom_id is distinct from p_classroom_id
        or v_object.provisional_owner_id is not null or v_object.status not in ('verified','ready')
        or v_object.storage_bucket is distinct from v_question->>'storage_bucket'
        or v_object.storage_path is distinct from v_question->>'storage_path'
        or v_object.storage_bucket is distinct from 'test-documents' then
        raise exception using errcode='PT400',message='test_draft_invalid_documents';
      end if;
      if v_object.purpose='test_execution_snapshot' then
        -- Snapshot identities originate only from the exact raw server
        -- baseline, never from a caller's uploaded-material identity. Preserve
        -- the original snapshot RPC's purpose/current-Test resource binding.
        if v_object.resource_type is distinct from 'test' or v_object.resource_id is distinct from p_test_id
          or not exists (
            select 1 from pg_catalog.jsonb_array_elements(coalesce(v_documents,'[]'::jsonb)) retained(value)
            join pg_catalog.jsonb_array_elements(coalesce(v_test.documents,'[]'::jsonb)) baseline(value)
              on baseline.value->>'id'=retained.value->>'id' and baseline.value->>'source'='link'
                and retained.value->>'source'='link' and baseline.value->>'url'=retained.value->>'url'
            where retained.value->>'snapshot_managed_object_id'=v_object.id::text
              and retained.value->>'snapshot_path'=v_object.storage_path
              and retained.value->'snapshot_managed_object_id'=baseline.value->'snapshot_managed_object_id'
              and retained.value->'snapshot_path'=baseline.value->'snapshot_path'
              and retained.value->'snapshot_content_type' is not distinct from baseline.value->'snapshot_content_type'
              and retained.value->'synced_at' is not distinct from baseline.value->'synced_at') then
          raise exception using errcode='PT400',message='test_draft_invalid_documents';
        end if;
      elsif v_object.purpose is distinct from 'teacher_test_material' or not exists (
        select 1 from pg_catalog.jsonb_array_elements(coalesce(v_documents,'[]'::jsonb)) material(value)
        where material.value->>'source'='upload' and material.value->>'managed_object_id'=v_object.id::text
          and material.value->>'storage_bucket'=v_object.storage_bucket and material.value->>'storage_path'=v_object.storage_path) then
        raise exception using errcode='PT400',message='test_draft_invalid_documents';
      end if;
    end if;
  end loop;
  -- Every identity must have a raw exact reference, and vice versa when the
  -- protocol is enforced.117 remains the final compatibility authority.
  if exists (select 1 from public.managed_storage_payload_ids(v_documents) identity
    where not identity.managed_object_id=any(v_object_ids)
      or not exists (select 1 from public.managed_storage_objects object where object.id=identity.managed_object_id
        and public.managed_storage_payload_has_exact_reference(v_documents,object.id,object.storage_bucket,object.storage_path))) then
    raise exception using errcode='PT400',message='test_draft_invalid_documents';
  end if;
  select coalesce(pg_catalog.array_agg(distinct document.value->>'snapshot_path'),array[]::text[])
    into v_paths from pg_catalog.jsonb_array_elements(coalesce(v_test.documents,'[]'::jsonb)) document(value)
    where nullif(document.value->>'snapshot_path','') is not null;
  perform 1 from public.test_document_snapshot_storage_cleanup cleanup where cleanup.storage_path=any(v_paths)
    order by cleanup.storage_path for update nowait;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(cleanup) order by cleanup.storage_path),'[]'::jsonb)
    into v_queue_before from public.test_document_snapshot_storage_cleanup cleanup where cleanup.storage_path=any(v_paths);
  select coalesce(sum(pg_catalog.octet_length(value::text)),0) into v_bytes
    from pg_catalog.jsonb_array_elements(v_objects_before || v_queue_before);
  if pg_catalog.octet_length(v_state_before::text)+v_bytes+pg_catalog.octet_length(v_source::text)
    +pg_catalog.octet_length(p_content::text)+pg_catalog.octet_length(coalesce(v_documents,'null'::jsonb)::text)>67108864 then
    raise exception using errcode='PT503',message='test_draft_source_limit';
  end if;
  if pg_catalog.clock_timestamp() >= v_phase_deadline then
    raise exception using errcode='PT503',message='test_draft_deadline';
  end if;
  v_write_started:=pg_catalog.clock_timestamp();
  begin
    v_inner_result:=public.save_test_draft_atomic(p_actor_id,p_test_id,p_expected_version,p_content,
      p_update_documents,v_test.documents,v_documents);
  exception when no_data_found then
    -- 134 RETURNING INTO STRICT raises before our reread when a BEFORE
    -- trigger suppresses a Draft/Test write. Treat that exact inner anomaly
    -- as a failed postcondition, not the initial missing-Test404 domain.
    raise exception using errcode='PT503',message='test_draft_postcondition_failed';
  end;
  if pg_catalog.clock_timestamp() >= v_phase_deadline then
    raise exception using errcode='PT503',message='test_draft_deadline';
  end if;
  select draft.* into v_after from public.assessment_drafts draft where draft.id=v_before.id;
  if not found or pg_catalog.to_jsonb(v_after) is distinct from pg_catalog.to_jsonb(v_expected) then
    raise exception using errcode='PT503',message='test_draft_postcondition_failed';
  end if;
  select test.* into v_test_after from public.tests test where test.id=p_test_id;
  if not found or pg_catalog.to_jsonb(v_test_after) is distinct from pg_catalog.to_jsonb(v_test_expected) then
    raise exception using errcode='PT503',message='test_draft_postcondition_failed';
  end if;
  v_state_after:=private.test_draft_save_state_v1(p_test_id);
  if v_state_after->'student_work' is distinct from v_state_before->'student_work' then
    raise exception using errcode='PT503',message='test_draft_postcondition_failed';
  end if;
  if v_test.status='draft' then
    if v_state_before->'questions' is distinct from v_state_after->'questions' then
      raise exception using errcode='PT503',message='test_draft_postcondition_failed';
    end if;
  else
    select coalesce(pg_catalog.jsonb_object_agg(coalesce(question.value->>'source_artifact_id',question.value->>'artifact_id'),question.value),'{}'::jsonb)
      into v_questions_after_map from pg_catalog.jsonb_array_elements(v_state_after->'questions') question(value);
    if exists (select 1 from pg_catalog.jsonb_array_elements(v_state_after->'questions') question(value)
      where coalesce(question.value->>'source_artifact_id',question.value->>'artifact_id') is null)
      or pg_catalog.jsonb_array_length(v_state_after->'questions') <> (
        select count(*) from pg_catalog.jsonb_object_keys(v_questions_after_map)) then
      raise exception using errcode='PT503',message='test_draft_postcondition_failed';
    end if;
    for v_question in select value from pg_catalog.jsonb_array_elements(p_content->'questions') loop
      v_actual_question:=v_questions_after_map->(v_question->>'id');
      if v_actual_question is null then raise exception using errcode='PT503',message='test_draft_postcondition_failed'; end if;
      v_old_question:=v_questions_before_map->(v_question->>'id');
      v_expected_question:=(v_question-'id') || pg_catalog.jsonb_build_object('test_id',p_test_id,'position',v_position,
        'question_text',pg_catalog.btrim(v_question->>'question_text'),
        'answer_key',nullif(pg_catalog.btrim(v_question->>'answer_key'),''),
        'sample_solution',nullif(pg_catalog.btrim(v_question->>'sample_solution'),''));
      if v_old_question is not null then
        v_expected_question:=v_old_question || v_expected_question;
        if v_expected_question is distinct from v_old_question then
          v_question_mutations:=v_question_mutations+1;
          v_expected_question:=v_expected_question || pg_catalog.jsonb_build_object('updated_at',pg_catalog.transaction_timestamp());
        end if;
      else
        -- Populate every unspecified current column with NULL, then name all
        -- actual nonnull defaults. Unknown future defaults fail closed.
        v_expected_question:=pg_catalog.to_jsonb(pg_catalog.jsonb_populate_record(null::public.test_questions,
          v_expected_question || pg_catalog.jsonb_build_object('id',v_actual_question->'id','artifact_id',v_question->'id',
            'created_at',pg_catalog.transaction_timestamp(),'updated_at',pg_catalog.transaction_timestamp())));
        v_question_mutations:=v_question_mutations+1;
      end if;
      if v_actual_question is distinct from v_expected_question then
        raise exception using errcode='PT503',message='test_draft_postcondition_failed';
      end if;
      v_expected_questions:=v_expected_questions || pg_catalog.jsonb_build_array(v_expected_question);
      v_position:=v_position+1;
    end loop;
    if v_state_after->'questions' is distinct from v_expected_questions then
      raise exception using errcode='PT503',message='test_draft_postcondition_failed';
    end if;
    select count(*) into v_matched_count from pg_catalog.jsonb_array_elements(v_state_before->'questions') question(value)
      where not exists (select 1 from pg_catalog.jsonb_array_elements(p_content->'questions') candidate(value)
        where candidate.value->>'id'=coalesce(question.value->>'source_artifact_id',question.value->>'artifact_id'));
    v_question_mutations:=v_question_mutations+v_matched_count::integer;
  end if;
  v_classroom_expected.blueprint_source_revision:=v_blueprint_before + 1 + v_question_mutations + v_test_changed;
  v_classroom_expected.updated_at:=pg_catalog.transaction_timestamp();
  select classroom.* into v_classroom_after from public.classrooms classroom where classroom.id=p_classroom_id;
  if not found or pg_catalog.to_jsonb(v_classroom_after) is distinct from pg_catalog.to_jsonb(v_classroom_expected) then
    raise exception using errcode='PT503',message='test_draft_postcondition_failed';
  end if;
  select revision.revision into v_archive_after from public.classroom_archive_revisions revision where revision.classroom_id=p_classroom_id;
  if not found or v_archive_after is distinct from v_archive_before + 3 + 2 * v_question_mutations + v_test_changed then
    raise exception using errcode='PT503',message='test_draft_postcondition_failed';
  end if;

  -- 134 always names documents in UPDATE:117 may replace reference IDs even
  -- for no-doc saves. Verify every semantic column, permitting only identity
  -- and created_at regeneration, exact ready/cleanup transitions and queues.
  v_evidence:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(coalesce(v_documents,'null'::jsonb)::text,'UTF8'),'sha256'),'hex');
  select coalesce(pg_catalog.jsonb_agg(expected.value order by expected.id),'[]'::jsonb) into v_refs_expected from (
    select distinct object.id,pg_catalog.jsonb_build_object('managed_object_id',object.id,
      'storage_bucket',object.storage_bucket,'storage_path',object.storage_path,'assignment_doc_id',null,
      'assignment_doc_history_id',null,'test_id',p_test_id,'course_blueprint_assessment_id',null,
      'course_blueprint_version_id',null,'course_blueprint_change_proposal_id',null,
      'reference_role','teacher_document','evidence_sha256',v_evidence) value
    from public.managed_storage_objects object where object.id=any(v_object_ids)
      and (object.id in (select managed_object_id from public.managed_storage_payload_ids(v_documents))
        or exists (select 1 from public.managed_storage_payload_raw_references(v_documents) reference
          where reference.storage_bucket=object.storage_bucket and reference.storage_path=object.storage_path))
  ) expected;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(reference)-array['id','created_at'] order by reference.managed_object_id),'[]'::jsonb)
    into v_refs_actual from public.managed_storage_json_references reference where reference.test_id=p_test_id;
  if v_refs_actual is distinct from v_refs_expected or exists (
    select 1 from public.managed_storage_json_references reference where reference.test_id=p_test_id
      and (reference.id=any(v_reference_row_ids) or reference.created_at<v_write_started
        or reference.created_at>pg_catalog.clock_timestamp())) then
    raise exception using errcode='PT503',message='test_draft_postcondition_failed';
  end if;
  for v_question in select value from pg_catalog.jsonb_array_elements(v_objects_before) loop
    v_object:=pg_catalog.jsonb_populate_record(null::public.managed_storage_objects,v_question);
    select object.* into v_object_after from public.managed_storage_objects object where object.id=v_object.id;
    if not found then raise exception using errcode='PT503',message='test_draft_postcondition_failed'; end if;
    if exists (select 1 from public.managed_storage_json_references reference where reference.test_id=p_test_id and reference.managed_object_id=v_object.id) then
      if v_object.status='verified' then
        v_effect_time:=v_object_after.ready_at;
        if v_effect_time is null or v_effect_time<v_write_started or v_effect_time>pg_catalog.clock_timestamp() then
          raise exception using errcode='PT503',message='test_draft_postcondition_failed';
        end if;
        v_object.status:='ready'; v_object.ready_at:=v_effect_time;
        v_object.reservation_expires_at:=null; v_object.updated_at:=v_object_after.updated_at;
      end if;
    elsif v_object.id=any(v_reference_ids) and v_object.status<>'deleted'
      and not (v_object.status='cleanup_processing' and v_object.lease_expires_at>pg_catalog.clock_timestamp())
      and not public.managed_storage_object_is_referenced(v_object.id) then
      v_object.status:='cleanup_pending'; v_object.cleanup_reason_code:='embedded_reference_removed';
      v_object.next_attempt_at:=v_object_after.next_attempt_at; v_object.updated_at:=v_object_after.updated_at;
      v_object.lease_token:=null; v_object.lease_expires_at:=null;
      if v_object.next_attempt_at<v_write_started or v_object.next_attempt_at>pg_catalog.clock_timestamp() then
        raise exception using errcode='PT503',message='test_draft_postcondition_failed';
      end if;
    end if;
    if pg_catalog.to_jsonb(v_object_after) is distinct from pg_catalog.to_jsonb(v_object)
      or (v_object_after.updated_at is distinct from (v_question->>'updated_at')::timestamptz
        and (v_object_after.updated_at<v_write_started or v_object_after.updated_at>pg_catalog.clock_timestamp())) then
      raise exception using errcode='PT503',message='test_draft_postcondition_failed';
    end if;
  end loop;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(cleanup) order by cleanup.storage_path),'[]'::jsonb)
    into v_queue_after from public.test_document_snapshot_storage_cleanup cleanup where cleanup.storage_path=any(v_paths);
  for v_path in select distinct pg_catalog.unnest(v_paths) path loop
    select value into v_queue_row from pg_catalog.jsonb_array_elements(v_queue_after) where value->>'storage_path'=v_path.path;
    select value into v_queue_expected from pg_catalog.jsonb_array_elements(v_queue_before) where value->>'storage_path'=v_path.path;
    select value into v_removed_snapshot from pg_catalog.jsonb_array_elements(coalesce(v_test.documents,'[]'::jsonb))
      where value->>'snapshot_path'=v_path.path and not exists (select 1 from pg_catalog.jsonb_array_elements(coalesce(v_documents,'[]'::jsonb)) retained(value)
        where retained.value->>'snapshot_path'=v_path.path);
    if v_removed_snapshot is not null and (v_queue_expected is null or v_queue_expected->>'status'<>'processing'
      or (v_queue_expected->>'lease_expires_at')::timestamptz<=v_write_started) then
      if v_queue_row is null or v_queue_row->>'status'<>'pending'
        or (v_queue_row->>'updated_at')::timestamptz<v_write_started
        or (v_queue_row->>'next_attempt_at')::timestamptz<v_write_started
        or (v_queue_row->>'updated_at')::timestamptz>pg_catalog.clock_timestamp()
        or (v_queue_row->>'next_attempt_at')::timestamptz>pg_catalog.clock_timestamp() then
        raise exception using errcode='PT503',message='test_draft_postcondition_failed';
      end if;
      if v_queue_expected is null then
        if (v_queue_row->>'created_at')::timestamptz<v_write_started
          or (v_queue_row->>'created_at')::timestamptz>pg_catalog.clock_timestamp() then
          raise exception using errcode='PT503',message='test_draft_postcondition_failed';
        end if;
        v_queue_expected:=pg_catalog.to_jsonb(pg_catalog.jsonb_populate_record(null::public.test_document_snapshot_storage_cleanup,
          pg_catalog.jsonb_build_object('id',v_queue_row->'id','storage_path',v_path.path,'managed_object_id',v_removed_snapshot->'snapshot_managed_object_id',
            'status','pending','attempt_count',0,'created_at',v_queue_row->'created_at',
            'updated_at',v_queue_row->'updated_at','next_attempt_at',v_queue_row->'next_attempt_at')));
      else
        v_queue_expected:=v_queue_expected || pg_catalog.jsonb_build_object('managed_object_id',
          coalesce(nullif(v_queue_expected->'managed_object_id','null'::jsonb),v_removed_snapshot->'snapshot_managed_object_id','null'::jsonb),
          'status','pending','lease_token',null,'lease_expires_at',null,'last_error',null,
          'updated_at',v_queue_row->'updated_at','next_attempt_at',v_queue_row->'next_attempt_at');
      end if;
    end if;
    if v_queue_row is distinct from v_queue_expected then
      raise exception using errcode='PT503',message='test_draft_postcondition_failed';
    end if;
  end loop;
  v_source_after:=private.test_draft_save_owner_source_v1(p_actor_id,p_test_id,p_classroom_id,p_deadline,v_phase_deadline);
  v_result:=pg_catalog.jsonb_build_object('version',1,'actor_id',p_actor_id,'classroom_id',p_classroom_id,
    'test_id',p_test_id,'operation',p_operation,'draft',pg_catalog.to_jsonb(v_after),
    'test', v_source_after->'test','editingPolicy',pg_catalog.jsonb_build_object('structureLocked',v_test_after.questions_locked_at is not null));
  if pg_catalog.octet_length(v_result::text)>8388608 then
    raise exception using errcode='PT503',message='test_draft_source_limit';
  end if;
  if pg_catalog.clock_timestamp() >= v_phase_deadline then
    raise exception using errcode='PT503',message='test_draft_deadline';
  end if;
  return v_result;
exception
  when sqlstate '40P01' or sqlstate '55P03' or sqlstate '40001' or sqlstate '23505' then
    raise exception using errcode='PT409',message='test_draft_busy';
  when sqlstate '55000' then
    if sqlerrm in ('classroom_purge_active','attendance_decommission_active') then
      raise exception using errcode='PT403',message='test_draft_fenced';
    elsif sqlerrm = 'test_questions_locked: Only question wording and existing choice text can change after a student starts' then
      raise exception using errcode='PT409',
        message = 'test_questions_locked: Only question wording and existing choice text can change after a student starts';
    else raise; end if;
end;
$function$;
revoke all on function public.finish_test_draft_save_for_owner_v1(uuid,uuid,uuid,text,integer,text,jsonb,jsonb,boolean,timestamptz) from public, anon, authenticated;
grant execute on function public.finish_test_draft_save_for_owner_v1(uuid,uuid,uuid,text,integer,text,jsonb,jsonb,boolean,timestamptz) to service_role;

commit;
