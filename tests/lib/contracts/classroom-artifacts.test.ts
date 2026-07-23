import { describe, expect, it } from 'vitest'
import {
  CLASSROOM_ACTOR_REFERENCE_COLUMNS,
  CLASSROOM_RELATIONAL_RESOURCES,
  GRADEX_RESOURCE_TABLES,
  auditClassroomResourceSchema,
  classroomResourceInventorySchema,
  getClassroomResourceOrder,
} from '@/lib/contracts/classroom-data'
import { CLASSROOM_ARCHIVE_V2_RESOURCES } from '@/lib/contracts/classroom-archive-resources'
import {
  CLASSROOM_ARCHIVE_FORMAT,
  CLASSROOM_ARCHIVE_VERSION,
  CLASSROOM_STORAGE_CONTRACT,
  COURSE_BLUEPRINT_TRANSFER_CONTRACT,
  GRADEX_DEIDENTIFICATION_CONTRACT,
  GRADEX_EXTRACT_FORMAT,
  GRADEX_EXTRACT_VERSION,
  classroomArchiveManifestSchema,
  classroomArchiveRestorePreflightSchema,
  gradexExtractManifestSchema,
  isClassroomArchiveRestoreReady,
  type ClassroomArchiveManifest,
} from '@/lib/contracts/classroom-artifacts'

const sha256 = 'b'.repeat(64)
const archiveId = '10000000-0000-4000-8000-000000000001'
const classroomId = '20000000-0000-4000-8000-000000000002'
const teacherId = '30000000-0000-4000-8000-000000000003'

function archiveResourceFiles() {
  return CLASSROOM_ARCHIVE_V2_RESOURCES.map((resource) => ({
    table: resource.table,
    path: `data/${resource.table}.ndjson`,
    row_count: 0,
    byte_size: 0,
    sha256,
  }))
}

function contractRelationships() {
  return CLASSROOM_RELATIONAL_RESOURCES.flatMap((resource) => {
    const ownershipRelationships = resource.scope.kind === 'root'
      ? []
      : resource.restore_after.map((parent) => ({
      child_table: resource.table,
      parent_table: parent,
      child_columns: [
        parent === resource.scope.parent ? resource.scope.column : `${parent}_id`,
      ],
    }))
    const actorRelationships = resource.actor_columns.map((column) => ({
      child_table: resource.table,
      parent_table: 'users',
      child_columns: [column],
    }))
    return [...ownershipRelationships, ...actorRelationships]
  })
}

function contractPrimaryKeys() {
  return CLASSROOM_RELATIONAL_RESOURCES.map((resource) => ({
    table_name: resource.table,
    columns: resource.primary_key,
  }))
}

function validArchiveManifest(): ClassroomArchiveManifest {
  return {
    format: CLASSROOM_ARCHIVE_FORMAT,
    version: CLASSROOM_ARCHIVE_VERSION,
    archive_id: archiveId,
    classroom_id: classroomId,
    teacher_id: teacherId,
    created_at: '2026-07-13T12:00:00.000Z',
    source: {
      schema_migration: '079',
      app_commit: 'cdfd5f035356446f0e83193a1f282e184ba2b872',
    },
    compression: 'tar+gzip',
    privacy_policy_version: 1,
    retention: {
      mode: 'teacher_managed',
      delete_after: null,
    },
    content_sha256: sha256,
    resources: archiveResourceFiles(),
    actors: {
      path: 'actors.ndjson',
      row_count: 0,
      byte_size: 0,
      sha256,
    },
    storage_objects: [],
  }
}

describe('classroom data inventory', () => {
  it('is a valid, complete 44-resource classroom ownership graph', () => {
    expect(classroomResourceInventorySchema.parse(CLASSROOM_RELATIONAL_RESOURCES)).toHaveLength(44)
    expect(new Set(CLASSROOM_RELATIONAL_RESOURCES.map((resource) => resource.table)).size).toBe(44)
    expect(CLASSROOM_RELATIONAL_RESOURCES[0].table).toBe('classrooms')
    expect(CLASSROOM_RELATIONAL_RESOURCES.find((resource) => resource.table === 'test_attempts')?.actor_columns)
      .toEqual(CLASSROOM_ACTOR_REFERENCE_COLUMNS.test_attempts)
    expect(CLASSROOM_RELATIONAL_RESOURCES.find((resource) =>
      resource.table === 'classroom_retired_assessment_records',
    )).toMatchObject({
      scope: {
        kind: 'foreign_key',
        parent: 'classrooms',
        column: 'classroom_id',
      },
      restore_after: ['classrooms'],
    })
    expect(CLASSROOM_RELATIONAL_RESOURCES.find((resource) =>
      resource.table === 'classroom_retired_assessment_record_actors',
    )).toMatchObject({
      actor_columns: ['actor_id'],
      scope: {
        kind: 'foreign_key',
        parent: 'classroom_retired_assessment_records',
        column: 'record_id',
      },
      restore_after: ['classroom_retired_assessment_records'],
    })
  })

  it('exports and restores parents first and purges children first', () => {
    const exportOrder = getClassroomResourceOrder('export')
    const purgeOrder = getClassroomResourceOrder('purge')

    expect(exportOrder[0]).toBe('classrooms')
    expect(exportOrder.indexOf('assignments')).toBeLessThan(exportOrder.indexOf('assignment_docs'))
    expect(exportOrder.indexOf('tests')).toBeLessThan(exportOrder.indexOf('test_responses'))
    expect(exportOrder.indexOf('test_questions')).toBeLessThan(exportOrder.indexOf('test_responses'))
    expect(exportOrder.indexOf('assignment_submission_requirements')).toBeLessThan(
      exportOrder.indexOf('assignment_submission_artifacts'),
    )
    expect(purgeOrder).toEqual([...exportOrder].reverse())
  })

  it('keeps Gradex limited to structured privacy-safe grading evidence', () => {
    expect(GRADEX_RESOURCE_TABLES).toEqual([
      'assignment_ai_grading_run_items',
      'assignment_ai_grading_runs',
      'assignment_docs',
      'assignment_feedback_entries',
      'assignment_repo_review_results',
      'assignment_repo_review_runs',
      'assignment_submission_requirements',
      'assignments',
      'test_ai_grading_run_items',
      'test_ai_grading_runs',
      'test_questions',
      'test_responses',
      'tests',
    ])
    expect(GRADEX_RESOURCE_TABLES).not.toContain('classroom_roster')
    expect(GRADEX_RESOURCE_TABLES).not.toContain('entries')
    expect(GRADEX_RESOURCE_TABLES).not.toContain('test_focus_events')
    expect(GRADEX_RESOURCE_TABLES).not.toContain('assignment_submission_artifacts')
  })

  it('detects schema resources that are not represented in the archive graph', () => {
    const relationships = contractRelationships()

    expect(auditClassroomResourceSchema([
      ...relationships,
      {
        child_table: 'classroom_retired_assessment_records',
        parent_table: 'classroom_retired_assessment_records',
        child_columns: ['parent_source_row_id'],
      },
    ], contractPrimaryKeys()).ok).toBe(true)
    expect(auditClassroomResourceSchema([
      ...relationships,
      {
        child_table: 'new_classroom_feature',
        parent_table: 'classrooms',
        child_columns: ['classroom_id'],
      },
    ], contractPrimaryKeys())).toEqual(expect.objectContaining({
      ok: false,
      untracked_tables: ['new_classroom_feature'],
    }))
  })

  it('detects stale resources, missing restore dependencies, and invalid selection keys', () => {
    const relationships = contractRelationships()
    const withoutQuizQuestions = relationships.filter((relationship) =>
      !(relationship.child_table === 'quiz_questions' && relationship.parent_table === 'quizzes'),
    )
    expect(auditClassroomResourceSchema(withoutQuizQuestions, contractPrimaryKeys())).toEqual(expect.objectContaining({
      ok: false,
      stale_tables: ['quiz_questions'],
    }))

    expect(auditClassroomResourceSchema([
      ...relationships,
      {
        child_table: 'assignment_docs',
        parent_table: 'classroom_roster',
        child_columns: ['roster_id'],
      },
    ], contractPrimaryKeys())).toEqual(expect.objectContaining({
      ok: false,
      missing_restore_dependencies: ['assignment_docs->classroom_roster'],
    }))

    const wrongAssignmentScope = relationships.map((relationship) =>
      relationship.child_table === 'assignments' && relationship.parent_table === 'classrooms'
        ? { ...relationship, child_columns: ['wrong_classroom_id'] }
        : relationship,
    )
    expect(auditClassroomResourceSchema(wrongAssignmentScope, contractPrimaryKeys())).toEqual(expect.objectContaining({
      ok: false,
      invalid_selection_scopes: ['assignments.classroom_id->classrooms'],
    }))

    const wrongPrimaryKeys = contractPrimaryKeys().map((primaryKey) =>
      primaryKey.table_name === 'assignments'
        ? { ...primaryKey, columns: ['classroom_id', 'id'] }
        : primaryKey,
    )
    expect(auditClassroomResourceSchema(relationships, wrongPrimaryKeys)).toEqual(expect.objectContaining({
      ok: false,
      invalid_primary_keys: ['assignments: expected (id) got (classroom_id,id)'],
    }))
  })

  it('detects untracked and stale user-reference columns used for actor snapshots', () => {
    const relationships = contractRelationships()
    expect(auditClassroomResourceSchema([
      ...relationships,
      { child_table: 'assignments', parent_table: 'users', child_columns: ['reviewed_by'] },
    ], contractPrimaryKeys())).toEqual(expect.objectContaining({
      ok: false,
      untracked_actor_references: ['assignments.reviewed_by'],
    }))

    const withoutAssignmentCreator = relationships.filter((relationship) =>
      !(relationship.child_table === 'assignments' &&
        relationship.parent_table === 'users' &&
        relationship.child_columns.includes('created_by')),
    )
    expect(auditClassroomResourceSchema(withoutAssignmentCreator, contractPrimaryKeys())).toEqual(
      expect.objectContaining({
        ok: false,
        stale_actor_references: ['assignments.created_by'],
      }),
    )
  })
})

describe('classroom artifact contracts', () => {
  it('keeps reusable blueprints explicitly non-recoverable and student-free', () => {
    expect(COURSE_BLUEPRINT_TRANSFER_CONTRACT.manifest_version).toBe('3')
    expect(COURSE_BLUEPRINT_TRANSFER_CONTRACT.supported_import_versions).toEqual(['2', '3'])
    expect(COURSE_BLUEPRINT_TRANSFER_CONTRACT.recoverable_classroom_backup).toBe(false)
    expect(COURSE_BLUEPRINT_TRANSFER_CONTRACT.excluded_data).toContain('student_work')
    expect(COURSE_BLUEPRINT_TRANSFER_CONTRACT.excluded_data).toContain('grades_and_feedback')
    expect(COURSE_BLUEPRINT_TRANSFER_CONTRACT.excluded_data).toContain('storage_objects')
  })

  it('uses private managed destinations and copies only referenced source objects', () => {
    expect(CLASSROOM_STORAGE_CONTRACT.destinations).toEqual([
      expect.objectContaining({ bucket: 'classroom-archives', visibility: 'private' }),
      expect.objectContaining({ bucket: 'gradex-analytics-extracts', visibility: 'private' }),
    ])
    expect(CLASSROOM_STORAGE_CONTRACT.sources.map((source) => source.bucket)).toEqual([
      'assignment-artifacts',
      'submission-images',
      'test-documents',
    ])
    expect(CLASSROOM_STORAGE_CONTRACT.sources.every((source) => source.copy_policy === 'referenced_only')).toBe(true)
  })

  it('requires one checksummed file for every current archive resource, including empty tables', () => {
    expect(classroomArchiveManifestSchema.safeParse(validArchiveManifest()).success).toBe(true)

    const missingResource = validArchiveManifest()
    missingResource.resources.pop()
    expect(classroomArchiveManifestSchema.safeParse(missingResource).success).toBe(false)

    const duplicateResource = validArchiveManifest()
    duplicateResource.resources[1] = duplicateResource.resources[0]
    expect(classroomArchiveManifestSchema.safeParse(duplicateResource).success).toBe(false)
  })

  it('rejects traversal and non-canonical paths in archive manifests', () => {
    const manifest = validArchiveManifest()
    manifest.storage_objects.push({
      bucket: 'assignment-artifacts',
      source_path: 'student-1/assignment-1/image.png',
      archive_path: 'objects/assignment-artifacts/../escape.png',
      byte_size: 10,
      sha256,
      content_type: 'image/png',
    })
    expect(classroomArchiveManifestSchema.safeParse(manifest).success).toBe(false)

    manifest.storage_objects[0].archive_path = 'objects\\assignment-artifacts\\image.png'
    expect(classroomArchiveManifestSchema.safeParse(manifest).success).toBe(false)
  })

  it('defines a strict Gradex manifest without raw classroom or user identifiers', () => {
    const resources = GRADEX_RESOURCE_TABLES.map((table) => ({
      table,
      path: `data/${table}.ndjson`,
      row_count: 0,
      byte_size: 0,
      sha256,
    }))
    const manifest = {
      format: GRADEX_EXTRACT_FORMAT,
      version: GRADEX_EXTRACT_VERSION,
      extract_id: archiveId,
      source_archive_ref: sha256,
      classroom_ref: 'c'.repeat(64),
      generated_at: '2026-07-13T12:00:00.000Z',
      compression: 'tar+gzip',
      content_sha256: sha256,
      pseudonymization: 'hmac-sha256-per-extract',
      timestamp_offsets_from: 'source-archive-created-at',
      privacy_policy_version: 2,
      direct_identifiers_removed: true,
      direct_identifier_findings: 0,
      privacy_scanner_version: 2,
      free_text_included: false,
      storage_objects_included: false,
      delete_after: '2026-10-11T12:00:00.000Z',
      resources,
    }

    expect(gradexExtractManifestSchema.safeParse(manifest).success).toBe(true)
    expect(gradexExtractManifestSchema.safeParse({ ...manifest, classroom_id: classroomId }).success).toBe(false)
    expect(gradexExtractManifestSchema.safeParse({
      ...manifest,
      resources: resources.filter((resource) => resource.table !== 'test_responses'),
    }).success).toBe(false)
    expect(gradexExtractManifestSchema.safeParse({
      ...manifest,
      delete_after: '2026-07-12T12:00:00.000Z',
    }).success).toBe(false)
    expect(gradexExtractManifestSchema.safeParse({
      ...manifest,
      delete_after: '2026-10-12T12:00:00.000Z',
    }).success).toBe(false)
  })

  it('requires identifiers, links, paths, and free text to be excluded or transformed before Gradex export', () => {
    expect(GRADEX_DEIDENTIFICATION_CONTRACT.identifier_fields).toBe('hmac_sha256_per_extract')
    expect(GRADEX_DEIDENTIFICATION_CONTRACT.forbidden_output_fields).toEqual(
      expect.arrayContaining(['email', 'student_number', 'url', 'storage_path']),
    )
    expect(GRADEX_DEIDENTIFICATION_CONTRACT.free_text).toBe('excluded_until_independent_dlp')
    expect(GRADEX_DEIDENTIFICATION_CONTRACT.release_gate).toBe(
      'structured_only_zero_detected_direct_identifiers',
    )
  })

  it('requires all verification and identity checks before restore is ready', () => {
    const ready = classroomArchiveRestorePreflightSchema.parse({
      archive_id: archiveId,
      target_schema_migration: '079',
      archive_checksum_verified: true,
      manifest_verified: true,
      resource_checksums_verified: true,
      resource_counts_verified: true,
      storage_objects_verified: true,
      actor_snapshots_verified: true,
      schema_adapter_available: true,
      unresolved_actor_ids: [],
    })
    expect(isClassroomArchiveRestoreReady(ready)).toBe(true)
    expect(isClassroomArchiveRestoreReady({
      ...ready,
      unresolved_actor_ids: [teacherId],
    })).toBe(false)
  })
})
