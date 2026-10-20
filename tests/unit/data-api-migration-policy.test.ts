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
