-- Prevent unrelated malformed percent escapes from poisoning managed-path
-- matching. Compare canonical encoded paths without decoding the surrounding
-- field, and decode only individual URL candidates as a compatibility fallback.

create or replace function public.classroom_purge_percent_encode_path(p_value text)
returns text
language plpgsql
immutable
strict
security definer
set search_path = pg_catalog
as $$
declare
  v_byte integer;
  v_bytes bytea := convert_to(p_value, 'UTF8');
  v_index integer;
  v_result text := '';
begin
  if octet_length(v_bytes) = 0 then
    return v_result;
  end if;

  for v_index in 0..octet_length(v_bytes) - 1 loop
    v_byte := get_byte(v_bytes, v_index);
    if
      (v_byte between 48 and 57)
      or (v_byte between 65 and 90)
      or (v_byte between 97 and 122)
      or v_byte in (33, 39, 40, 41, 42, 45, 46, 47, 95, 126)
    then
      v_result := v_result || chr(v_byte);
    else
      v_result := v_result || '%' || upper(lpad(to_hex(v_byte), 2, '0'));
    end if;
  end loop;
  return v_result;
end;
$$;

create or replace function public.classroom_purge_normalize_percent_escapes(p_value text)
returns text
language plpgsql
immutable
strict
security definer
set search_path = pg_catalog
as $$
declare
  v_character text;
  v_hex text;
  v_index integer := 1;
  v_result text := '';
begin
  while v_index <= char_length(p_value) loop
    v_character := substr(p_value, v_index, 1);
    if v_character = '%'
      and v_index + 2 <= char_length(p_value)
      and substr(p_value, v_index + 1, 2) ~ '^[0-9A-Fa-f]{2}$'
    then
      v_hex := substr(p_value, v_index + 1, 2);
      v_result := v_result || '%' || upper(v_hex);
      v_index := v_index + 3;
    else
      v_result := v_result || v_character;
      v_index := v_index + 1;
    end if;
  end loop;
  return v_result;
end;
$$;

create or replace function public.classroom_purge_url_candidates(p_value text)
returns setof text
language sql
immutable
strict
security definer
set search_path = pg_catalog
as $$
  select match[1]
  from regexp_matches(p_value, '(https?://[^[:space:]]+)', 'g') match;
$$;

create or replace function public.classroom_purge_jsonb_references_storage_path(
  p_payload jsonb,
  p_storage_path text
)
returns boolean
language sql
immutable
strict
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.classroom_purge_jsonb_text_values(p_payload) candidate(value)
    where strpos(candidate.value, p_storage_path) > 0
      or strpos(
        public.classroom_purge_normalize_percent_escapes(candidate.value),
        public.classroom_purge_percent_encode_path(p_storage_path)
      ) > 0
      or exists (
        select 1
        from public.classroom_purge_url_candidates(candidate.value) url(value)
        where strpos(
          coalesce(public.classroom_purge_percent_decode(url.value), ''),
          p_storage_path
        ) > 0
      )
  );
$$;

revoke all on function public.classroom_purge_percent_encode_path(text)
  from public, anon, authenticated;
revoke all on function public.classroom_purge_normalize_percent_escapes(text)
  from public, anon, authenticated;
revoke all on function public.classroom_purge_url_candidates(text)
  from public, anon, authenticated;
revoke all on function public.classroom_purge_jsonb_references_storage_path(jsonb, text)
  from public, anon, authenticated;

comment on function public.classroom_purge_percent_encode_path(text) is
  'Encodes a managed path like segment-wise encodeURIComponent while retaining path separators.';
comment on function public.classroom_purge_normalize_percent_escapes(text) is
  'Normalizes percent-escape hex case without decoding or rejecting unrelated field content.';
comment on function public.classroom_purge_url_candidates(text) is
  'Isolates URL candidates so malformed unrelated text cannot poison managed-path decoding.';
comment on function public.classroom_purge_jsonb_references_storage_path(jsonb, text) is
  'Matches raw, canonical encoded, or independently decoded URL path references without whole-field decode coupling.';
