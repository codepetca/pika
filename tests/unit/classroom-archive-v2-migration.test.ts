import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CLASSROOM_ARCHIVE_V2_RESOURCES,
  LEGACY_QUIZ_ARCHIVE_V1_RESOURCES,
} from '@/lib/contracts/classroom-archive-resources'

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/105_classroom_archive_v2_contract.sql',
  ),
  'utf8',
)

function functionDefinition(name: string, parameterMarker: string) {
  const definitions = migration.match(
    new RegExp(
      `create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
      'g',
    ),
  ) || []
  return definitions.find((definition) => definition.includes(parameterMarker))
}

describe('classroom archive-v2 contract migration', () => {
  it('adds private, classroom-owned retired assessment envelopes', () => {
    expect(migration).toContain(
      'create table public.classroom_retired_assessment_records (',
    )
    expect(migration).toContain(
      'create table public.classroom_retired_assessment_record_actors (',
    )
    expect(migration).toContain(
      "checksum_algorithm = 'sha256-canonical-json-v1'",
    )
    expect(migration).toContain(
      'payload->>\'id\' = source_row_id::text',
    )
    expect(migration).toContain(
      'references public.classroom_retired_assessment_records (id) on delete cascade',
    )
    expect(migration).toContain(
      'actor_id uuid not null references public.users (id) on delete restrict',
    )
    expect(migration).toContain(
      'alter table public.classroom_retired_assessment_records enable row level security;',
    )
    expect(migration).toContain(
      'revoke all on table public.classroom_retired_assessment_records',
    )
    expect(migration).toContain(
      'grant select on table public.classroom_retired_assessment_records to service_role;',
    )
  })

  it('keeps the deployed v1 registry while adding a composite version registry', () => {
    expect(migration).toContain(
      'create table public.classroom_archive_resource_contract_versions (',
    )
    expect(migration).toContain(
      'primary key (format_version, table_name)',
    )
    expect(migration).toContain(
      'from public.classroom_archive_resource_contract',
    )
    expect(migration).toContain(
      'add constraint classroom_archive_resource_versions_parent_fkey',
    )
    expect(migration.indexOf(
      'add constraint classroom_archive_resource_versions_parent_fkey',
    )).toBeLessThan(migration.indexOf(
      'alter table public.classroom_archive_resource_contract_versions\n  enable row level security;',
    ))
    expect(migration).not.toMatch(
      /drop table(?: if exists)? public\.classroom_archive_resource_contract/i,
    )

    expect(migration).toContain('format_version,\n  table_name,')
    for (const resource of CLASSROOM_ARCHIVE_V2_RESOURCES) {
      if (resource.table.startsWith('classroom_retired_assessment_')) {
        expect(migration).toContain(`'${resource.table}'`)
      }
    }
    for (const table of LEGACY_QUIZ_ARCHIVE_V1_RESOURCES) {
      expect(migration).toContain(`'${table}'`)
    }
  })

  it('pins operation, snapshot, and staging rows to explicit contracts', () => {
    expect(migration).toContain(
      'add column source_contract_version integer not null default 1',
    )
    expect(migration).toContain(
      'add column archive_format_version integer not null default 1',
    )
    expect(migration).toContain(
      'add column restore_contract_version integer not null default 1',
    )
    expect(migration).toContain(
      'add column source_resource_counts jsonb not null default \'{}\'::jsonb',
    )
    expect(migration).toContain(
      'foreign key (source_contract_version, table_name)',
    )
    expect(migration).toContain(
      'foreign key (restore_contract_version, table_name)',
    )
    expect(migration).toContain(
      'create trigger pin_classroom_archive_snapshot_contract',
    )
    expect(migration).toContain(
      'create trigger pin_classroom_archive_restore_contract',
    )
    expect(migration).toContain(
      'check (format_version in (1, 2))',
    )
  })

  it('supports a v1 source snapshot and distinct archive-v2 metadata', () => {
    const begin = functionDefinition(
      'begin_classroom_archive_export_v2',
      'p_archive_format_version integer',
    )
    const complete = functionDefinition(
      'complete_classroom_archive_export_v2',
      'p_archive_resource_counts jsonb',
    )

    expect(begin).toContain('p_source_contract_version integer')
    expect(begin).toContain('p_source_contract_version <> 1')
    expect(begin).toContain('p_archive_format_version <> 2')
    expect(begin).toContain(
      'v_result := private.begin_classroom_archive_export_v082(',
    )
    expect(migration).toContain(
      ') rename to begin_classroom_archive_export_v082;',
    )
    expect(migration).toContain(
      'create or replace function public.begin_classroom_archive_export(',
    )
    expect(migration).toContain(
      'from public.classroom_archive_revisions\n  where classroom_id = p_classroom_id\n  for update;',
    )
    expect(begin).toContain(
      "'archive_v2_envelope_source_not_supported'",
    )
    expect(begin?.indexOf(
      "v_operation.status is distinct from 'completed'",
    )).toBeGreaterThan(begin?.indexOf(
      'where id = p_operation_id',
    ) || -1)
    expect(complete).toContain(
      'p_resource_counts is distinct from v_operation.source_resource_counts',
    )
    expect(complete).toContain(
      'resource_counts = p_archive_resource_counts',
    )
    expect(complete).toContain(
      "'%s/%s/%s/classroom-v2.tar.gz'",
    )
    expect(complete).toContain(
      'where format_version = v_operation.source_contract_version',
    )
  })

  it('accepts either archive source version while staging only the v2 graph', () => {
    const begin = functionDefinition(
      'begin_classroom_archive_restore_v2',
      'p_source_resource_counts jsonb',
    )
    const stage = functionDefinition(
      'stage_classroom_archive_restore_rows_v2',
      'p_restore_contract_version integer',
    )
    const complete = functionDefinition(
      'complete_classroom_archive_restore_v2',
      'p_restore_contract_version integer',
    )

    expect(begin).toContain('p_source_contract_version not in (1, 2)')
    expect(begin).toContain('p_restore_contract_version <> 2')
    expect(begin).toContain(
      'v_archive.resource_counts <> p_source_resource_counts',
    )
    expect(begin).toContain('v_compat_resource_counts')
    expect(begin).toContain(
      'source_resource_counts = p_source_resource_counts',
    )
    expect(stage).toContain(
      'from public.classroom_archive_resource_contract_versions',
    )
    expect(stage).toContain(
      'restore_contract_version = p_restore_contract_version',
    )
    expect(complete).toContain(
      'where format_version = p_restore_contract_version',
    )
    expect(complete).toContain(
      'resolve_classroom_archive_resource_classroom_id_versioned',
    )
    expect(complete).toContain(
      'set constraints public.ensure_current_assignment_submit_history immediate;',
    )
  })

  it('retains previous RPC signatures behind version dispatchers', () => {
    expect(migration).toContain(
      'create or replace function public.begin_classroom_archive_export_v2(',
    )
    expect(migration).toContain(
      'create or replace function public.stage_classroom_archive_object_upload_v2(',
    )
    expect(migration).toContain(
      'create or replace function public.complete_classroom_archive_export_v2(',
    )
    expect(migration).toContain(
      'create or replace function public.begin_classroom_archive_restore_v2(',
    )
    expect(migration).toContain(
      'create or replace function public.stage_classroom_archive_restore_rows_v2(',
    )
    expect(migration).toContain(
      'create or replace function public.complete_classroom_archive_restore_v2(',
    )
    expect(migration).toContain(
      'private.stage_classroom_archive_object_upload_v082(',
    )
    expect(migration).toContain(
      'private.stage_classroom_archive_restore_rows_v094(',
    )
    expect(migration).toContain(
      'private.complete_classroom_archive_restore_v099(',
    )
    expect(migration).toContain(
      "if v_operation_type <> 'export' or v_archive_format_version = 1 then",
    )
    expect(migration).toContain(
      'if v_restore_contract_version = 1 then',
    )
    expect(migration).toContain(
      'grant execute on function public.stage_classroom_archive_restore_rows(',
    )
    expect(migration).toContain(
      'grant execute on function public.complete_classroom_archive_restore(',
    )
  })

  it('does not mutate source Quiz data or redefine unrelated archive paths', () => {
    expect(migration).not.toMatch(
      /\b(?:drop table|delete from|update|insert into)\s+public\.(?:quizzes|quiz_questions|quiz_responses|quiz_student_scores)\b/i,
    )
    expect(migration).not.toContain(
      'create or replace function public.begin_classroom_archive_compaction',
    )
    expect(migration).not.toContain(
      'create or replace function public.complete_classroom_archive_compaction',
    )
    expect(migration).not.toContain(
      'create or replace function public.begin_classroom_gradex_extract',
    )
  })
})
