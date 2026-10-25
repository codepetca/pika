import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { checkDataApiMigration } from '../../scripts/check-data-api-migration-policy.mjs'

const table = 'create table public.example(id bigint generated always as identity);'
const access = `alter table public.example enable row level security;
revoke all on table public.example from public, anon, authenticated;
grant select, insert on table public.example to service_role;
revoke all on sequence public.example_id_seq from public, anon, authenticated;
grant usage, select on sequence public.example_id_seq to service_role;`

describe('new public table migration policy', () => {
  it('accepts only the built-in C collation operand while retaining quoted-name restrictions', () => {
    expect(checkDataApiMigration(`create function private.canonical() returns text language sql as $$select string_agg(key,',' order by key collate "C") from jsonb_object_keys('{}') key$$;`)).toEqual([])
    expect(() => checkDataApiMigration('create table public."C"(id uuid);')).toThrow('simple lowercase')
    expect(() => checkDataApiMigration('select key collate "Arbitrary";')).toThrow('simple lowercase')
  })
  it('runs in the workflow suite and the ephemeral database lane', () => {
    const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts
    expect(scripts['check:data-api-migrations']).toBe('node scripts/check-data-api-migration-policy.mjs')
    expect(scripts['check:workflow']).toContain('tests/unit/data-api-migration-policy.test.ts')
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
    const database = workflow.split('  architecture-database-contracts:\n')[1].split(/\n  [a-z][a-z-]*:\n/)[0]
    expect(database).toContain('pnpm run check:data-api-migrations')
    expect(database).toContain('bash scripts/check-data-api-grants-database.sh')
  })
  it('requires an explicit access decision and RLS in the creating migration', () => {
    expect(checkDataApiMigration(table)).toContain('public.example: missing service_role GRANT or REVOKE')
    expect(checkDataApiMigration(table)).toContain('public.example: missing client-role REVOKE')
    expect(checkDataApiMigration(table)).toContain('public.example: missing ENABLE ROW LEVEL SECURITY')
    expect(checkDataApiMigration(`${table}\n${access}`)).toEqual([])
  })
  it('allows RPC-only tables to deny service_role directly', () => {
    expect(checkDataApiMigration(`${table}\n${access.replace('grant select, insert on table public.example to service_role;', 'revoke all on public.example from service_role;')}`)).toEqual([])
  })
  it('does not accept comments, strings, or function bodies as grants', () => {
    const fake = `${access.split('\n').map(line => `-- ${line}`).join('\n')}\nselect '${access}'; do $$ begin ${access} end $$;`
    expect(checkDataApiMigration(`${table}\n${fake}`)).toEqual(expect.arrayContaining(checkDataApiMigration(table)))
    expect(checkDataApiMigration(`${table}\n${fake}`)).toContain('routine-body relation/default ACLs require top-level policy decisions')
  })
  it('handles nested comments, quoted names and unqualified public tables', () => {
    expect(checkDataApiMigration(`/* outer /* inner */ comment */ ${table} ${access}`)).toEqual([])
    expect(checkDataApiMigration(`${table} ${access}`.replaceAll('public.example', '"public"."example"'))).toEqual([])
    expect(checkDataApiMigration(`${table} ${access}`.replaceAll('public.example', 'example'))).toEqual([])
  })
  it('rejects public client grants and automatic table/sequence grants', () => {
    expect(checkDataApiMigration('grant select on public.example to authenticated;')).toContain('public client table/sequence GRANT is forbidden')
    expect(checkDataApiMigration('grant select on all tables in schema public to anon;')).toContain('public client table/sequence GRANT is forbidden')
    expect(checkDataApiMigration('grant usage on sequence public.example_id_seq to anon with grant option;')).toContain('public client table/sequence GRANT is forbidden')
    expect(checkDataApiMigration('grant truncate on public.example to group authenticated;')).toContain('public client table/sequence GRANT is forbidden')
    expect(checkDataApiMigration('alter default privileges for role postgres in schema public grant all on tables to service_role;')).toContain('automatic public table/sequence GRANT is forbidden')
    expect(checkDataApiMigration('alter default privileges in schema public grant usage on sequences to service_role;')).toContain('automatic public table/sequence GRANT is forbidden')
  })
  it('leaves custom schemas and function ACLs to their existing contracts', () => {
    expect(checkDataApiMigration('create table private.example(id uuid); grant execute on function public.rpc() to service_role;')).toEqual([])
  })
  it('requires explicit sequence decisions including generated identity sequences', () => {
    expect(checkDataApiMigration(`${table}\n${access.split('\n').filter(line => !line.includes('sequence')).join('\n')}`)).toContain('public.example_id_seq: missing service_role GRANT or REVOKE')
    expect(checkDataApiMigration('create sequence public.audit_seq;')).toContain('public.audit_seq: missing service_role GRANT or REVOKE')
    expect(checkDataApiMigration('create unlogged sequence public.audit_seq;')).toContain('public.audit_seq: missing service_role GRANT or REVOKE')
  })
  it.each([
    'alter table public.example add column id bigserial;',
    'alter table public.example add id integer generated always as identity;',
    'alter table public.example alter column id add generated by default as identity;',
  ])('checks sequence ACLs created by %s', ddl => {
    expect(checkDataApiMigration(ddl)).toContain('public.example_id_seq: missing service_role GRANT or REVOKE')
    expect(checkDataApiMigration(`${ddl} ${access}`)).toEqual([])
  })
  it.each([
    'do $$ begin grant select on table public.example to authenticated; end $$;',
    'do $$ begin grant truncate on table public.example to anon; end $$;',
    "do $$ begin execute 'grant truncate on public.example to authenticated'; end $$;",
  ])('rejects a hidden relation ACL: %s', ddl => {
    expect(checkDataApiMigration(ddl)).toContain('routine-body relation/default ACLs require top-level policy decisions')
  })
  it('rejects dynamic sequence DDL and ignores escaped top-level string examples', () => {
    expect(checkDataApiMigration("do $$ begin execute 'create sequence public.audit_seq'; end $$;")).toContain('dynamic public table DDL requires an explicit policy review')
    expect(checkDataApiMigration(String.raw`select E'example\'; grant truncate on public.example to authenticated;';`)).toEqual([])
  })
  it.each([
    "do 'begin grant truncate on table public.example to authenticated; end';",
    String.raw`do E'begin execute \'grant select on public.example to anon\'; end';`,
    "do 'begin alter default privileges grant select on tables to anon; end';",
    "do 'begin create sequence public.audit_seq; end';",
    "create function public.f() returns void as 'begin grant truncate on public.example to authenticated; end' language plpgsql;",
    "create function public.f() returns void as'begin grant truncate on public.example to authenticated; end' language plpgsql;",
    "create procedure public.p() language plpgsql as 'begin create sequence public.audit_seq; end';",
  ])('rejects unsupported string-form executable bodies: %s', ddl => {
    expect(checkDataApiMigration(ddl)).toContain('use dollar-quoted DO/function/procedure bodies for migration policy review')
  })
  it('handles function EXECUTE ACL whitespace consistently and does not invent sequences on DROP IDENTITY', () => {
    for (const gap of [' ', '  ', '\n']) expect(checkDataApiMigration(`do $$ begin grant execute on${gap}function public.rpc() to service_role; end $$;`)).toEqual([])
    expect(checkDataApiMigration('alter table public.example alter column id drop identity;')).toEqual([])
  })
  it.each([
    'do $$ begin grant/* review */ select on table public.example to authenticated; end $$;',
    'do $$ begin grant/* outer /* inner */ review */truncate on table public.example to anon; end $$;',
    'do $$ begin grant -- review\n truncate on table public.example to anon; end $$;',
    "do $$ begin execute 'grant/* review */truncate on table public.example to authenticated'; end $$;",
    'do $$ begin alter/* review */default privileges grant select on tables to authenticated; end $$;',
  ])('tokenizes SQL comments inside executable bodies: %s', ddl => {
    expect(checkDataApiMigration(ddl)).toContain('routine-body relation/default ACLs require top-level policy decisions')
  })
  it('retains ordinary routine strings and function EXECUTE grants with comments', () => {
    expect(checkDataApiMigration("do $$ begin raise notice '-- data, not a SQL comment'; grant/* review */ execute on /* reviewed */ function public.rpc() to service_role; end $$;")).toEqual([])
  })
  it.each([
    "do $$ begin raise notice 'cannot create user''s record'; end $$;",
    "do $$ begin raise exception 'cannot alter user''s record'; end $$;",
    "do $$ begin message := 'grant on user''s data'; end $$;",
    "do $$ begin execute 'select $1' using 'cannot create user''s record'; end $$;",
    "do $$ begin execute format('select %L', 'cannot create user''s record'); end $$;",
  ])('preserves notice, error, assignment and SQL data literals: %s', sql => {
    expect(checkDataApiMigration(sql)).toEqual([])
  })
  it('inspects only the executable command template of EXECUTE format', () => {
    expect(checkDataApiMigration("do $$ begin execute pg_catalog.format('grant/* review */ select on table public.%I to authenticated', 'example'); end $$;")).toContain('routine-body relation/default ACLs require top-level policy decisions')
    expect(() => checkDataApiMigration("do $$ begin execute format('%s', 'grant select on public.example to authenticated'); end $$;")).toThrow('literal command template')
  })
  it('rejects unsupported executable body delimiters instead of ignoring them', () => {
    expect(() => checkDataApiMigration('do $é$ begin grant truncate on public.example to authenticated; end $é$;')).toThrow('Use ASCII dollar-quote tags')
    expect(checkDataApiMigration('create procedure public.p() language sql begin atomic grant truncate on public.example to authenticated; end;')).toContain('use dollar-quoted routine bodies instead of inline BEGIN ATOMIC')
  })
  it('rejects alternate public search paths and dynamic table creation', () => {
    expect(checkDataApiMigration('set search_path=private; create table example(id uuid);')).toContain('use schema-qualified DDL instead of SET search_path')
    expect(checkDataApiMigration('do $$ begin execute \'create table public.example(id uuid)\'; end $$;')).toContain('dynamic public table DDL requires an explicit policy review')
  })
  it('enforces all migrations after the audited 001–280 legacy chain', () => {
    const files = readdirSync('supabase/migrations').filter(name => /^\d{3}_.*\.sql$/.test(name) && Number(name.slice(0, 3)) > 280)
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) expect(checkDataApiMigration(readFileSync(`supabase/migrations/${file}`, 'utf8')), file).toEqual([])
  })
})
