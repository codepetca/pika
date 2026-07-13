import { execFileSync } from 'node:child_process'
import {
  auditClassroomResourceSchema,
  type ClassroomSchemaRelationship,
} from '../src/lib/contracts/classroom-data'

const relationshipQuery = `
with relationships as (
  select
    child.relname as child_table,
    parent.relname as parent_table,
    array_agg(child_column.attname order by columns.ordinality) as child_columns
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
)
select coalesce(
  json_agg(relationships order by parent_table, child_table),
  '[]'::json
)::text
from relationships;
`

const databaseUrl = process.env.CLASSROOM_SCHEMA_AUDIT_DATABASE_URL
if (!databaseUrl) {
  process.stderr.write('CLASSROOM_SCHEMA_AUDIT_DATABASE_URL is required.\n')
  process.exit(2)
}

const output = execFileSync(
  'psql',
  ['--dbname', databaseUrl, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', relationshipQuery],
  { encoding: 'utf8' },
)
const relationships = JSON.parse(output.trim()) as ClassroomSchemaRelationship[]
const audit = auditClassroomResourceSchema(relationships)

if (!audit.ok) {
  process.stderr.write(`Classroom resource schema contract failed:\n${JSON.stringify(audit, null, 2)}\n`)
  process.exit(1)
}

process.stdout.write(
  `Classroom resource schema contract passes (${relationships.length} foreign-key relationships).\n`,
)
