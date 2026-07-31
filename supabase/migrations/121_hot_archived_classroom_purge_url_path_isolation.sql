-- Match the URL pathname only. Query and fragment data are not part of a
-- Storage object key and must not be able to poison path decoding.

create or replace function public.classroom_purge_url_candidates(p_value text)
returns setof text
language sql
immutable
strict
security definer
set search_path = pg_catalog
as $$
  select split_part(
    split_part(matched[1], '#', 1),
    '?',
    1
  )
  from regexp_matches(p_value, '(https?://[^[:space:]]+)', 'g') matched;
$$;

revoke all on function public.classroom_purge_url_candidates(text)
  from public, anon, authenticated;

comment on function public.classroom_purge_url_candidates(text) is
  'Isolates URL scheme, authority, and pathname so query or fragment escapes cannot poison managed-path decoding.';
