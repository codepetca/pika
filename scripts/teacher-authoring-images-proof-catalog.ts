/** Inert, additive291 catalog SQL. Historical catalogs remain exact when291 is
 * absent; an installed extension must match every fixed capability below.
 * This prepares source checks and grants no native execution authority. */
export const TEACHER_AUTHORING_IMAGE_TRIGGER_PAIRS = Object.freeze([
  ['assignments', 'assignments_authoring_image_references'],
  ['classwork_materials', 'materials_authoring_image_references'],
  ['tests', 'tests_authoring_image_references'],
  ['test_questions', 'test_questions_authoring_image_references'],
  ['survey_questions', 'survey_questions_authoring_image_references'],
  ['assessment_drafts', 'assessment_drafts_authoring_image_references'],
  ['test_ai_grading_run_items', 'test_ai_grading_run_items_authoring_image_references'],
].map((pair) => Object.freeze(pair)))

export const TEACHER_AUTHORING_IMAGE_ROUTINE_MD5 = Object.freeze({
  sync_teacher_authoring_image_references: '44924f909c004d858e0ff2058334074e',
  queue_removed_teacher_authoring_image: 'fa9ba373a241ef8467a490dedcdda57e',
  managed_storage_object_is_referenced: '1fe0a7daed9782ac2b38f541fc6010ff',
})
const q = (value: string) => `'${value.replaceAll("'", "''")}'`
const ledger = "pg_catalog.to_regclass('public.teacher_authoring_image_references')"

/** Exact UNION rows, never a filter that hides an unexpected installed trigger. */
export function teacherAuthoringImageTriggerRowsSql(tables: readonly string[], includeTable: boolean) {
  return TEACHER_AUTHORING_IMAGE_TRIGGER_PAIRS.filter(([table]) => tables.includes(table))
    .map(([table, trigger]) => `select ${includeTable ? `${q(table)}::text,` : ''}${q(trigger)}::text,'public'::text,'sync_teacher_authoring_image_references'::text,29 where ${ledger} is not null`)
    .join(' union all ')
}

/** Nested PL/pgSQL block usable inside the existing exact catalog probes. */
export function teacherAuthoringImagesCatalogSql() {
  const pairs = TEACHER_AUTHORING_IMAGE_TRIGGER_PAIRS.map(([table, trigger]) => `(${q(table)},${q(trigger)})`).join(',')
  return `declare authoring_proc pg_catalog.pg_proc;authoring_table pg_catalog.pg_class;begin
 if ${ledger} is null then
   if pg_catalog.to_regprocedure('public.sync_teacher_authoring_image_references()') is not null
     or pg_catalog.to_regprocedure('public.queue_removed_teacher_authoring_image()') is not null
     or exists(select 1 from pg_catalog.pg_trigger t where t.tgname in (${TEACHER_AUTHORING_IMAGE_TRIGGER_PAIRS.map(([, trigger]) => q(trigger)).join(',')},'removed_teacher_authoring_image_cleanup'))
   then raise exception 'Partial authoring291 catalog differs';end if;
 else
 select c.* into strict authoring_table from pg_catalog.pg_class c where c.oid=${ledger};
 if authoring_table.relkind<>'r' or not authoring_table.relrowsecurity or authoring_table.relforcerowsecurity
   or pg_catalog.pg_get_userbyid(authoring_table.relowner)<>'postgres'
   or (select pg_catalog.array_agg(a.attname::text order by a.attnum) from pg_catalog.pg_attribute a where a.attrelid=authoring_table.oid and a.attnum>0 and not a.attisdropped)
      is distinct from array['owner_table','owner_id','classroom_id','managed_object_id']::text[]
   or exists(select 1 from pg_catalog.pg_attribute a where a.attrelid=authoring_table.oid and a.attnum>0 and not a.attisdropped
     and (not a.attnotnull or pg_catalog.format_type(a.atttypid,a.atttypmod)<>case when a.attname='owner_table' then 'text' else 'uuid' end))
   or exists(select 1 from pg_catalog.aclexplode(coalesce(authoring_table.relacl,pg_catalog.acldefault('r',authoring_table.relowner))) a
     where a.grantee<>authoring_table.relowner and (a.grantee<>'service_role'::regrole or a.privilege_type<>'SELECT' or a.is_grantable))
   or not pg_catalog.has_table_privilege('service_role',authoring_table.oid,'SELECT')
   or exists(select 1 from pg_catalog.pg_attribute a cross join lateral pg_catalog.aclexplode(a.attacl) acl where a.attrelid=authoring_table.oid and acl.grantee<>authoring_table.relowner)
   or exists(select 1 from pg_catalog.pg_policy authoring_policy where authoring_policy.polrelid=authoring_table.oid)
   or not exists(select 1 from pg_catalog.pg_constraint c where c.conrelid=authoring_table.oid and c.contype='c'
     and c.conname='teacher_authoring_image_references_owner_table_check' and c.convalidated and not c.connoinherit
     and pg_catalog.regexp_replace(pg_catalog.replace(pg_catalog.pg_get_expr(c.conbin,c.conrelid),'::text',''),'[()[:space:]]','','g')
       = 'owner_table=ANYARRAY[''assignments'',''classwork_materials'',''tests'',''test_questions'',''survey_questions'',''assessment_drafts'',''test_ai_grading_run_items'']')
   or (select count(*) from pg_catalog.pg_constraint c where c.conrelid=authoring_table.oid and c.contype<>'t')<>4
   or not exists(select 1 from pg_catalog.pg_constraint c where c.conrelid=authoring_table.oid and c.contype='p'
     and pg_catalog.pg_get_constraintdef(c.oid)='PRIMARY KEY (owner_table, owner_id, managed_object_id)' and c.convalidated and not c.condeferrable)
   or not exists(select 1 from pg_catalog.pg_constraint c where c.conrelid=authoring_table.oid and c.contype='f'
     and c.confrelid='public.classrooms'::regclass and c.confdeltype='c' and c.confupdtype='a' and not c.condeferrable and c.convalidated
     and c.conkey=array[3]::smallint[] and c.confkey=array[(select a.attnum from pg_catalog.pg_attribute a where a.attrelid=c.confrelid and a.attname='id')]::smallint[])
   or not exists(select 1 from pg_catalog.pg_constraint c where c.conrelid=authoring_table.oid and c.contype='f'
     and c.confrelid='public.managed_storage_objects'::regclass and c.confdeltype='r' and c.confupdtype='a' and not c.condeferrable and c.convalidated
     and c.conkey=array[4]::smallint[] and c.confkey=array[(select a.attnum from pg_catalog.pg_attribute a where a.attrelid=c.confrelid and a.attname='id')]::smallint[])
   or (select count(*) from pg_catalog.pg_index i where i.indrelid=authoring_table.oid)<>2
   or not exists(select 1 from pg_catalog.pg_index i join pg_catalog.pg_class c on c.oid=i.indexrelid
     join pg_catalog.pg_am am on am.oid=c.relam where i.indrelid=authoring_table.oid and c.relname='teacher_authoring_image_reference_object'
     and not i.indisunique and i.indisvalid and i.indisready and i.indnkeyatts=1 and i.indnatts=1 and i.indkey::text='4'
     and i.indpred is null and i.indexprs is null and am.amname='btree')
 then raise exception 'Authoring291 reference ledger capability differs';end if;
 ${(['sync_teacher_authoring_image_references', 'queue_removed_teacher_authoring_image'] as const).map((name) => `
 select authoring_catalog_proc.* into strict authoring_proc from pg_catalog.pg_proc authoring_catalog_proc where authoring_catalog_proc.oid=${q(`public.${name}()`)}::regprocedure;
 if authoring_proc.pronargs<>0 or authoring_proc.prorettype<>'trigger'::regtype or not authoring_proc.prosecdef
   or authoring_proc.provolatile<>'v' or authoring_proc.prolang<>(select oid from pg_catalog.pg_language where lanname='plpgsql')
   or pg_catalog.pg_get_userbyid(authoring_proc.proowner)<>'postgres'
   or authoring_proc.proconfig is distinct from array['search_path=""']::text[]
   or pg_catalog.md5(authoring_proc.prosrc)<>${q(TEACHER_AUTHORING_IMAGE_ROUTINE_MD5[name])}
   or exists(select 1 from pg_catalog.aclexplode(coalesce(authoring_proc.proacl,pg_catalog.acldefault('f',authoring_proc.proowner))) a where a.grantee<>authoring_proc.proowner)
 then raise exception 'Authoring291 trigger routine capability differs';end if;`).join('')}
 select authoring_catalog_proc.* into strict authoring_proc from pg_catalog.pg_proc authoring_catalog_proc where authoring_catalog_proc.oid='public.managed_storage_object_is_referenced(uuid)'::regprocedure;
 if authoring_proc.pronargs<>1 or authoring_proc.prorettype<>'boolean'::regtype or authoring_proc.prosecdef
   or authoring_proc.provolatile<>'s' or authoring_proc.prolang<>(select oid from pg_catalog.pg_language where lanname='sql')
   or pg_catalog.pg_get_userbyid(authoring_proc.proowner)<>'postgres'
   or authoring_proc.proconfig is distinct from array['search_path=""']::text[]
   or pg_catalog.md5(authoring_proc.prosrc)<>${q(TEACHER_AUTHORING_IMAGE_ROUTINE_MD5.managed_storage_object_is_referenced)}
 then raise exception 'Authoring291 liveness routine differs';end if;
 if exists(select 1 from (values ${pairs}) e(table_name,trigger_name)
   left join pg_catalog.pg_class c on c.relname=e.table_name and c.relnamespace='public'::regnamespace
   left join pg_catalog.pg_trigger t on t.tgrelid=c.oid and t.tgname=e.trigger_name
   where t.oid is null or t.tgfoid<>'public.sync_teacher_authoring_image_references()'::regprocedure or t.tgisinternal
     or t.tgtype<>29 or t.tgenabled<>'O' or t.tgdeferrable or t.tginitdeferred or t.tgconstraint<>0
     or t.tgattr::text<>'' or t.tgqual is not null or t.tgnargs<>0 or pg_catalog.octet_length(t.tgargs)<>0)
   or (select count(*) from pg_catalog.pg_trigger t where t.tgrelid=authoring_table.oid and not t.tgisinternal)<>1
   or not exists(select 1 from pg_catalog.pg_trigger t where t.tgrelid=authoring_table.oid
     and t.tgname='removed_teacher_authoring_image_cleanup' and t.tgtype=9 and t.tgenabled='O' and not t.tgisinternal
     and t.tgfoid='public.queue_removed_teacher_authoring_image()'::regprocedure and t.tgdeferrable and t.tginitdeferred
     and t.tgconstraint<>0 and t.tgattr::text='' and t.tgqual is null and t.tgnargs=0 and pg_catalog.octet_length(t.tgargs)=0)
 then raise exception 'Authoring291 exact trigger modes differ';end if;
 end if;end;`
}
