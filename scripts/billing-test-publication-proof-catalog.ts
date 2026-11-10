import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const cutoffColumn = `select 1 from pg_catalog.pg_attribute cutoff_column
 where cutoff_column.attrelid=pg_catalog.to_regclass('private.stripe_billing_settings')
 and cutoff_column.attname='classroom_new_work_cutoff_enabled'
 and cutoff_column.attnum>0 and not cutoff_column.attisdropped`
const guardName = 'private.guard_billing_test_publication_v1()'
const helperName = 'private.billing_classroom_can_start_work_v1(uuid)'
const triggerName = 'billing_test_publication_cutoff'

// Exact prosrc hashes from the sealed migrations, including comments.
const guardBodyMd5 = '6e9cc625aba50f138e1b1714cae1793d'
const initialHelperMd5 = '7d0dca30c10ebbb76c142fe8f7b55991'
const capacityHelperMd5 = '01c4c38989192bebff06711ef409d5ff'

/** Bind the expected capability to the reviewed source profile before SQL runs. */
export function billingTestPublicationProofCatalog(repository: string) {
  const hasMigration = (name: string) => existsSync(resolve(repository, 'supabase/migrations', name))
  const cutoffExpected = hasMigration('308_billing_classroom_test_start_cutoff.sql')
  const helperBodyMd5 = hasMigration('309_billing_classroom_capacity_restrictions.sql') ? capacityHelperMd5 : initialHelperMd5
  const checkSql = cutoffExpected ? `if not exists(
   ${cutoffColumn}
   and cutoff_column.atttypid='boolean'::regtype and cutoff_column.attnotnull
   and exists(select 1 from pg_catalog.pg_attrdef cutoff_default
     where cutoff_default.adrelid=cutoff_column.attrelid and cutoff_default.adnum=cutoff_column.attnum
     and pg_catalog.pg_get_expr(cutoff_default.adbin,cutoff_default.adrelid)='false')
 ) then raise exception 'Billing308 Test publication column differs';end if;
 if (select count(*) from private.stripe_billing_settings)<>1
 or not exists(select 1 from private.stripe_billing_settings where singleton and not classroom_new_work_cutoff_enabled)
 then raise exception 'Billing308 Test publication setting differs';end if;
 if exists(
   select 1 from (values
     ('${guardName}','trigger'::regtype,'${guardBodyMd5}'),
     ('${helperName}','boolean'::regtype,'${helperBodyMd5}')
   ) cutoff_expected(signature,return_type,body_md5)
   where not exists(select 1 from pg_catalog.pg_proc cutoff_proc
     where cutoff_proc.oid=pg_catalog.to_regprocedure(cutoff_expected.signature)
     and cutoff_proc.prorettype=cutoff_expected.return_type and cutoff_proc.prosecdef and cutoff_proc.provolatile='v'
     and pg_catalog.pg_get_userbyid(cutoff_proc.proowner)='postgres'
     and cutoff_proc.prolang=(select oid from pg_catalog.pg_language where lanname='plpgsql')
     and cutoff_proc.proconfig=array['search_path=""']::text[]
     and pg_catalog.md5(cutoff_proc.prosrc)=cutoff_expected.body_md5
     and not exists(select 1 from pg_catalog.aclexplode(coalesce(cutoff_proc.proacl,pg_catalog.acldefault('f',cutoff_proc.proowner))) acl
       where acl.grantee<>cutoff_proc.proowner))
 ) then raise exception 'Billing308 Test publication routine differs';end if;
 if not exists(
   select 1 from pg_catalog.pg_trigger cutoff_trigger
   join pg_catalog.pg_attribute cutoff_status on cutoff_status.attrelid=cutoff_trigger.tgrelid
     and cutoff_status.attname='status' and not cutoff_status.attisdropped
   where cutoff_trigger.tgrelid='public.tests'::regclass and cutoff_trigger.tgname='${triggerName}'
   and cutoff_trigger.tgfoid=pg_catalog.to_regprocedure('${guardName}')
   and not cutoff_trigger.tgisinternal and cutoff_trigger.tgenabled='O' and not cutoff_trigger.tgdeferrable and not cutoff_trigger.tginitdeferred
   and cutoff_trigger.tgtype=19 and cutoff_trigger.tgattr::text=cutoff_status.attnum::text and cutoff_trigger.tgnargs=0
   and pg_catalog.substring(pg_catalog.pg_get_triggerdef(cutoff_trigger.oid,false),' WHEN [(](.*)[)] EXECUTE FUNCTION ')
     ='((old.status = ''draft''::text) AND (new.status = ''active''::text))'
 ) then raise exception 'Billing308 Test publication capability differs';end if;` : `if exists(${cutoffColumn})
 or pg_catalog.to_regprocedure('${guardName}') is not null
 or pg_catalog.to_regprocedure('${helperName}') is not null
 then raise exception 'Unexpected billing308 Test publication capability';end if;`
  return {
    checkSql,
    triggerRowSql: (includeTable: boolean) => `select ${includeTable ? "'tests'::text," : ''}'${triggerName}'::text,
 'private'::text,'guard_billing_test_publication_v1'::text,19 where ${cutoffExpected}`,
  }
}
