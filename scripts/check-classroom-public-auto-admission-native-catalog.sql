-- Isolated replay-only 297 catalog checks; no provider calls or production mutation.
\set ON_ERROR_STOP on
DO $check$
DECLARE item record; target regprocedure;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='private.classroom_public_auto_admission_policy'::regclass AND relrowsecurity AND relkind='r') THEN
    RAISE EXCEPTION 'auto policy table or RLS missing';
  END IF;
  IF EXISTS (SELECT 1 FROM (VALUES ('anon'),('authenticated'),('service_role')) AS r(name)
    WHERE has_table_privilege(r.name,'private.classroom_public_auto_admission_policy','select,insert,update,delete')) THEN
    RAISE EXCEPTION 'auto policy table privilege too broad';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='private.classroom_experience_admission_policy'::regclass
    AND tgname='classroom_auto_admission_master_stop' AND tgenabled='O' AND NOT tgisinternal
    AND tgfoid='private.classroom_auto_admission_master_stop_v1()'::regprocedure) THEN
    RAISE EXCEPTION 'auto admission master-stop trigger missing';
  END IF;
  FOR item IN SELECT * FROM (VALUES
    ('public.set_classroom_auto_admission_enabled_v1(boolean)'),
    ('public.ensure_verified_classroom_admission_v1(uuid,text)'),
    ('public.read_verified_classroom_auto_admission_eligibility_v1(uuid,text)')) AS t(name)
  LOOP
    target := to_regprocedure(item.name);
    IF target IS NULL OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=target AND prosecdef
      AND proconfig @> ARRAY['search_path=""'])
      OR has_function_privilege('anon',target,'execute') OR has_function_privilege('authenticated',target,'execute')
      OR NOT has_function_privilege('service_role',target,'execute') THEN
      RAISE EXCEPTION 'auto admission RPC catalog mismatch: %', item.name;
    END IF;
  END LOOP;
  IF (SELECT enabled FROM private.classroom_public_auto_admission_policy WHERE singleton) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'auto admission must default off';
  END IF;
END
$check$;
