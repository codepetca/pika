/** Additive migration 308 capability for the closed Test lifecycle catalogs. */
const cutoffColumn = `exists(
 select 1 from pg_catalog.pg_attribute a
 where a.attrelid=pg_catalog.to_regclass('private.stripe_billing_settings')
 and a.attname='classroom_new_work_cutoff_enabled' and a.attnum>0 and not a.attisdropped
)`
const guardName = 'private.guard_billing_test_publication_v1()'
const triggerName = 'billing_test_publication_cutoff'
const guardBodyMd5 = '6e9cc625aba50f138e1b1714cae1793d'

export function billingTestPublicationTriggerRowSql(includeTable: boolean) {
  return `select ${includeTable ? "'tests'::text," : ''}'${triggerName}'::text,
 'private'::text,'guard_billing_test_publication_v1'::text,19 where ${cutoffColumn}`
}

export function billingTestPublicationCatalogSql() {
  return `if ${cutoffColumn} then
 if not exists(
   select 1 from pg_catalog.pg_trigger cutoff_trigger
   join pg_catalog.pg_proc cutoff_proc on cutoff_proc.oid=cutoff_trigger.tgfoid
   join pg_catalog.pg_attribute a on a.attrelid=cutoff_trigger.tgrelid and a.attname='status' and not a.attisdropped
   where cutoff_trigger.tgrelid='public.tests'::regclass and cutoff_trigger.tgname='${triggerName}'
   and cutoff_trigger.tgfoid=pg_catalog.to_regprocedure('${guardName}')
   and not cutoff_trigger.tgisinternal and cutoff_trigger.tgenabled='O' and not cutoff_trigger.tgdeferrable and not cutoff_trigger.tginitdeferred
   and cutoff_trigger.tgtype=19 and cutoff_trigger.tgattr::text=a.attnum::text and cutoff_trigger.tgnargs=0
   and lower(pg_catalog.regexp_replace(replace(
     pg_catalog.substring(pg_catalog.pg_get_triggerdef(cutoff_trigger.oid,false),' WHEN [(](.*)[)] EXECUTE FUNCTION '),
     '::text',''),'[()[:space:]]','','g'))='old.status=''draft''andnew.status=''active'''
   and cutoff_proc.prorettype='trigger'::regtype and cutoff_proc.prosecdef and cutoff_proc.provolatile='v'
   and pg_catalog.pg_get_userbyid(cutoff_proc.proowner)='postgres'
   and cutoff_proc.prolang=(select oid from pg_catalog.pg_language where lanname='plpgsql')
   and cutoff_proc.proconfig=array['search_path=""']::text[] and pg_catalog.md5(cutoff_proc.prosrc)='${guardBodyMd5}'
   and not exists(select 1 from pg_catalog.aclexplode(coalesce(cutoff_proc.proacl,pg_catalog.acldefault('f',cutoff_proc.proowner))) acl
     where acl.grantee<>cutoff_proc.proowner)
 ) then raise exception 'Billing308 Test publication capability differs';end if;
 elsif pg_catalog.to_regprocedure('${guardName}') is not null then
   raise exception 'Partial billing308 Test publication capability differs';
 end if;`
}
