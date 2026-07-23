import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CLASSROOM_ARCHIVE_CONTRACTS,
  CLASSROOM_ARCHIVE_CURRENT_EXPORT_VERSION,
  classroomArchiveManifestV1Schema,
  classroomArchiveManifestV2Schema,
  parseClassroomArchiveManifest,
} from '@/lib/contracts/classroom-artifacts'
import {
  CLASSROOM_ARCHIVE_V1_RESOURCES,
  CLASSROOM_ARCHIVE_V2_RESOURCES,
  LEGACY_QUIZ_ARCHIVE_V1_RESOURCES,
} from '@/lib/contracts/classroom-archive-resources'
import { CLASSROOM_RELATIONAL_RESOURCES } from '@/lib/contracts/classroom-data'

const UUID = '00000000-0000-4000-8000-000000000001'
const SHA256 = 'a'.repeat(64)

function resourceDescriptors(resources: readonly { table: string }[]) {
  return resources.map((resource) => ({
    table: resource.table,
    path: `data/${resource.table}.ndjson`,
    row_count: 0,
    byte_size: 0,
    sha256: SHA256,
  }))
}

function manifest(version: 1 | 2, resources: readonly { table: string }[]) {
  return {
    format: 'pika.classroom-archive',
    version,
    archive_id: UUID,
    classroom_id: UUID,
    teacher_id: UUID,
    created_at: '2026-07-23T12:00:00.000Z',
    source: {
      schema_migration: '082_verified_classroom_archive_exports',
      app_commit: 'abcdef1',
    },
    compression: 'tar+gzip',
    privacy_policy_version: 1,
    retention: { mode: 'teacher_managed', delete_after: null },
    content_sha256: SHA256,
    resources: resourceDescriptors(resources),
    actors: {
      path: 'actors.ndjson',
      row_count: 0,
      byte_size: 0,
      sha256: SHA256,
    },
    storage_objects: [],
  }
}

describe('versioned classroom archive contracts', () => {
  it('freezes v1 independently from the live database resource inventory', () => {
    expect(CLASSROOM_ARCHIVE_CURRENT_EXPORT_VERSION).toBe(2)
    expect(CLASSROOM_ARCHIVE_V1_RESOURCES).not.toBe(CLASSROOM_RELATIONAL_RESOURCES)
    expect(CLASSROOM_ARCHIVE_V1_RESOURCES).toHaveLength(42)
    expect(CLASSROOM_RELATIONAL_RESOURCES).toHaveLength(44)
    expect(
      createHash('sha256')
        .update(JSON.stringify(CLASSROOM_ARCHIVE_V1_RESOURCES))
        .digest('hex'),
    ).toBe('b7fe6fdd6dcbb57a741e13f1d16d3b171fc105d2f945cef48bb3d5791d0f9c5d')
    expect(CLASSROOM_ARCHIVE_V1_RESOURCES).toEqual(
      CLASSROOM_RELATIONAL_RESOURCES
        .filter((resource) =>
          !resource.table.startsWith('classroom_retired_assessment_'),
        )
        .map((resource) => ({
          table: resource.table,
          primary_key: resource.primary_key,
          actor_columns: resource.actor_columns,
        })),
    )
    expect(readFileSync(
      resolve(process.cwd(), 'src/lib/contracts/classroom-archive-resources.ts'),
      'utf8',
    )).not.toContain("from '@/lib/contracts/classroom-data'")
  })

  it('activates a v2 graph with retired envelopes and no Quiz tables', () => {
    const v2Tables = CLASSROOM_ARCHIVE_V2_RESOURCES.map((resource) => resource.table)

    expect(CLASSROOM_ARCHIVE_CONTRACTS[1]).toMatchObject({
      exportEnabled: true,
      restoreEnabled: true,
      gradexEnabled: true,
    })
    expect(CLASSROOM_ARCHIVE_CONTRACTS[2]).toMatchObject({
      exportEnabled: true,
      restoreEnabled: true,
      gradexEnabled: false,
    })
    expect(v2Tables).toEqual(expect.arrayContaining([
      'classroom_retired_assessment_records',
      'classroom_retired_assessment_record_actors',
    ]))
    expect(v2Tables).toEqual(expect.not.arrayContaining(LEGACY_QUIZ_ARCHIVE_V1_RESOURCES))
  })

  it('dispatches exact schemas and rejects cross-version resource graphs', () => {
    const v1 = manifest(1, CLASSROOM_ARCHIVE_V1_RESOURCES)
    const v2 = manifest(2, CLASSROOM_ARCHIVE_V2_RESOURCES)

    expect(parseClassroomArchiveManifest(v1).version).toBe(1)
    expect(parseClassroomArchiveManifest(v2).version).toBe(2)
    expect(classroomArchiveManifestV1Schema.safeParse({ ...v2, version: 1 }).success)
      .toBe(false)
    expect(classroomArchiveManifestV2Schema.safeParse({ ...v1, version: 2 }).success)
      .toBe(false)
    expect(() => parseClassroomArchiveManifest({ ...v1, version: 3 }))
      .toThrow('Unsupported classroom archive version: 3')
  })
})
