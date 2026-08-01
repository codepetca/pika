import { execFileSync } from 'node:child_process'
import {
  auditClassroomResourceSchema,
  type ClassroomSchemaIndex,
  type ClassroomSchemaPrimaryKey,
  type ClassroomSchemaRelationship,
} from '../src/lib/contracts/classroom-data'
import {
  hostedSupabasePsqlEnvironment,
  localSupabasePsqlEnvironment,
  type PsqlConnectionEnvironment,
} from '../src/lib/server/supabase-target'

const schemaQuery = `
with relationships as (
  select
    child.relname as child_table,
    parent.relname as parent_table,
    array_agg(child_column.attname order by columns.ordinality) as child_columns,
    case constraint_definition.confdeltype
      when 'c' then 'cascade'
      when 'r' then 'restrict'
      when 'n' then 'set null'
      when 'd' then 'set default'
      else 'no action'
    end as delete_action
  from pg_constraint constraint_definition
  join pg_class child on child.oid = constraint_definition.conrelid
  join pg_namespace child_namespace on child_namespace.oid = child.relnamespace
  join pg_class parent on parent.oid = constraint_definition.confrelid
  join pg_namespace parent_namespace on parent_namespace.oid = parent.relnamespace
  join lateral unnest(constraint_definition.conkey) with ordinality columns(attnum, ordinality)
    on true
  join pg_attribute child_column
    on child_column.attrelid = child.oid
    and child_column.attnum = columns.attnum
  where constraint_definition.contype = 'f'
    and child_namespace.nspname = 'public'
    and parent_namespace.nspname = 'public'
  group by constraint_definition.oid, child.relname, parent.relname
),
primary_keys as (
  select
    relation.relname as table_name,
    array_agg(column_definition.attname order by key_columns.ordinality) as columns
  from pg_constraint constraint_definition
  join pg_class relation on relation.oid = constraint_definition.conrelid
  join pg_namespace relation_namespace on relation_namespace.oid = relation.relnamespace
  join lateral unnest(constraint_definition.conkey) with ordinality key_columns(attnum, ordinality)
    on true
  join pg_attribute column_definition
    on column_definition.attrelid = relation.oid
    and column_definition.attnum = key_columns.attnum
  where constraint_definition.contype = 'p'
    and relation_namespace.nspname = 'public'
  group by constraint_definition.oid, relation.relname
),
indexes as (
  select
    relation.relname as table_name,
    array_agg(column_definition.attname order by index_columns.ordinality)
      filter (where column_definition.attname is not null) as columns
  from pg_index index_definition
  join pg_class relation on relation.oid = index_definition.indrelid
  join pg_namespace relation_namespace on relation_namespace.oid = relation.relnamespace
  join lateral unnest(index_definition.indkey) with ordinality index_columns(attnum, ordinality)
    on index_columns.ordinality <= index_definition.indnkeyatts
  left join pg_attribute column_definition
    on column_definition.attrelid = relation.oid
    and column_definition.attnum = index_columns.attnum
  where relation_namespace.nspname = 'public'
    and index_definition.indisvalid
    and index_definition.indisready
    and index_definition.indpred is null
    and index_definition.indexprs is null
  group by index_definition.indexrelid, relation.relname
)
select json_build_object(
  'relationships', coalesce(
    (select json_agg(relationships order by parent_table, child_table) from relationships),
    '[]'::json
  ),
  'primary_keys', coalesce(
    (select json_agg(primary_keys order by table_name) from primary_keys),
    '[]'::json
  ),
  'indexes', coalesce(
    (select json_agg(indexes order by table_name, columns) from indexes),
    '[]'::json
  )
)::text;
`

const databaseUrl = process.env.CLASSROOM_SCHEMA_AUDIT_DATABASE_URL
if (!databaseUrl) {
  process.stderr.write('CLASSROOM_SCHEMA_AUDIT_DATABASE_URL is required.\n')
  process.exit(2)
}
const expectedProjectRef = process.env.CLASSROOM_SCHEMA_AUDIT_EXPECTED_PROJECT_REF
const localMode = process.env.CLASSROOM_SCHEMA_AUDIT_LOCAL === 'true'
if ((expectedProjectRef ? 1 : 0) + (localMode ? 1 : 0) !== 1) {
  process.stderr.write(
    'Set exactly one of CLASSROOM_SCHEMA_AUDIT_EXPECTED_PROJECT_REF or CLASSROOM_SCHEMA_AUDIT_LOCAL=true.\n',
  )
  process.exit(2)
}
let connectionEnvironment: PsqlConnectionEnvironment
try {
  connectionEnvironment = expectedProjectRef
    ? hostedSupabasePsqlEnvironment(databaseUrl, expectedProjectRef)
    : localSupabasePsqlEnvironment(databaseUrl)
} catch {
  process.stderr.write('Classroom resource schema target validation failed.\n')
  process.exit(2)
}
const childProcessEnvironment: NodeJS.ProcessEnv = {}
for (const name of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL'] as const) {
  const value = process.env[name]
  if (value !== undefined) childProcessEnvironment[name] = value
}

let output: string
try {
  output = execFileSync(
    'psql',
    ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', schemaQuery],
    {
      encoding: 'utf8',
      env: { ...childProcessEnvironment, ...connectionEnvironment },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
} catch {
  process.stderr.write('Classroom resource schema query failed for the validated target.\n')
  process.exit(1)
}
const schema = JSON.parse(output.trim()) as {
  relationships: ClassroomSchemaRelationship[]
  primary_keys: ClassroomSchemaPrimaryKey[]
  indexes: ClassroomSchemaIndex[]
}
const audit = auditClassroomResourceSchema(
  schema.relationships,
  schema.primary_keys,
  schema.indexes,
)

if (!audit.ok) {
  process.stderr.write(`Classroom resource schema contract failed:\n${JSON.stringify(audit, null, 2)}\n`)
  process.exit(1)
}

process.stdout.write(
  `Classroom resource schema contract passes (${schema.relationships.length} foreign-key relationships)` +
  `${expectedProjectRef ? ` for project ${expectedProjectRef}` : ''}.\n`,
)
