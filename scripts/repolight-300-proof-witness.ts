/** Fixed source-profile witness for isolated replay only; it grants no DB authority. */
const tables = [
  'private.repolight_settings', 'private.repolight_managed_connections',
  'private.repolight_provision_control', 'private.repolight_provision_outbox',
  'private.stripe_billing_settings', 'public.account_plans', 'public.billing_account_access',
] as const

/** Full rows and exact trigger/function metadata; caller must seal source300 first. */
export function repoLight300WitnessSql(): string {
  const rows = tables.map(table => `'${table}',(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) from ${table} r)`).join(',')
  return `jsonb_build_object('rows',jsonb_build_object(${rows}),
 'triggers',(select coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,t.tgname,pg_get_triggerdef(t.oid),t.tgenabled,t.tgdeferrable,t.tginitdeferred) order by n.nspname,c.relname,t.tgname),'[]'::jsonb)
 from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace
 where not t.tgisinternal and (n.nspname,c.relname,t.tgname) in
 (('public','billing_account_access','repolight_provision_billing_hint'),('public','account_plans','repolight_provision_plan_hint'),
 ('private','repolight_settings','repolight_provision_access_gate_hint'),('private','stripe_billing_settings','repolight_provision_billing_gate_hint'))),
 'functions',(select coalesce(jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_functiondef(p.oid),p.proacl) order by n.nspname,p.proname),'[]'::jsonb)
 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
 where n.nspname='private' and p.proname in ('repolight_provision_account_hint_v1','repolight_provision_gate_hint_v1')))`
}

/** Prove the fresh isolated fixture starts dormant with exactly the reviewed triggers. */
export function repoLight300PresenceSql(): string {
  return `do $repolight300$ begin
 if (select count(*) from private.repolight_settings)<>1
 or not exists(select 1 from private.repolight_settings where singleton and not plan_enforcement_enabled and not legacy_plan_access_enabled and not billing_access_enabled and not managed_provisioning_enabled)
 or (select count(*) from private.repolight_provision_control)<>1
 or not exists(select 1 from private.repolight_provision_control where singleton and epoch=1)
 or exists(select 1 from private.repolight_managed_connections) or exists(select 1 from private.repolight_provision_outbox)
 or exists(select 1 from (values
 ('public.billing_account_access','repolight_provision_billing_hint','repolight_provision_account_hint_v1',21,array[]::text[]),
 ('public.account_plans','repolight_provision_plan_hint','repolight_provision_account_hint_v1',21,array[]::text[]),
 ('private.repolight_settings','repolight_provision_access_gate_hint','repolight_provision_gate_hint_v1',17,array['billing_access_enabled','legacy_plan_access_enabled','managed_provisioning_enabled']::text[]),
 ('private.stripe_billing_settings','repolight_provision_billing_gate_hint','repolight_provision_gate_hint_v1',17,array['provider_mode','sandbox_enabled']::text[])
 ) expected(rel,name,fn,kind,attrs) where not exists(select 1 from pg_catalog.pg_trigger t
 join pg_catalog.pg_proc p on p.oid=t.tgfoid join pg_catalog.pg_namespace n on n.oid=p.pronamespace
 where t.tgrelid=pg_catalog.to_regclass(expected.rel) and t.tgname=expected.name and not t.tgisinternal
 and t.tgenabled='O' and not t.tgdeferrable and not t.tginitdeferred and t.tgtype=expected.kind
 and t.tgqual is null and t.tgnargs=0
 and n.nspname='private' and p.proname=expected.fn and p.prosecdef and p.proconfig=array['search_path=""']::text[]
 and coalesce((select array_agg(a.attname::text order by a.attname::text) from pg_catalog.unnest(t.tgattr::smallint[]) x(attnum)
 join pg_catalog.pg_attribute a on a.attrelid=t.tgrelid and a.attnum=x.attnum),array[]::text[])=expected.attrs))
 then raise exception 'RepoLight300 isolated fixture differs';end if;end;$repolight300$;`
}

/** Add a fixed 300-only witness without changing historical graph bytes. */
export function withRepoLight300Witness(graph: string, reviewed300: boolean): string {
  return reviewed300 ? `(${graph}) || jsonb_build_object('__repolight300',${repoLight300WitnessSql()})` : graph
}
