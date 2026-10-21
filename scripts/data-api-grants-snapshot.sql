-- Deterministic ACL/owner/RLS evidence, independent of object OIDs and ACL order.
-- Only the isolated harness runs this; it never reads application row data.
with objects as (
  select 'relation' as kind, n.nspname as schema_name, c.relname as object_name,
    jsonb_build_array(c.relkind, pg_get_userbyid(c.relowner), c.relrowsecurity,
      c.relforcerowsecurity, coalesce((select jsonb_agg(
        jsonb_build_array(case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
          pg_get_userbyid(a.grantor), a.privilege_type, a.is_grantable)
        order by a.grantee = 0, pg_get_userbyid(a.grantee), a.privilege_type, a.is_grantable)
        from aclexplode(coalesce(c.relacl, acldefault(case when c.relkind = 'S' then 'S'::"char" else 'r'::"char" end, c.relowner))) a), '[]'::jsonb)) as state
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private') and c.relkind in ('r','p','v','m','f','S')
  union all
  select 'function', n.nspname, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
    jsonb_build_array(pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig,
      (select jsonb_agg(jsonb_build_array(case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
          pg_get_userbyid(a.grantor), a.privilege_type, a.is_grantable)
        order by a.grantee = 0, pg_get_userbyid(a.grantee), a.privilege_type, a.is_grantable)
        from aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) a))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private')
  union all
  select 'function-default', coalesce(n.nspname, '*'), pg_get_userbyid(d.defaclrole),
    (select jsonb_agg(jsonb_build_array(case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
      pg_get_userbyid(a.grantor), a.privilege_type, a.is_grantable)
      order by a.grantee = 0, pg_get_userbyid(a.grantee), a.privilege_type, a.is_grantable) from aclexplode(d.defaclacl) a)
  from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace where d.defaclobjtype = 'f'
)
select jsonb_build_array(kind, schema_name, object_name, state)::text
from objects order by kind, schema_name, object_name;
