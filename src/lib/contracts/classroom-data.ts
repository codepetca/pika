import { z } from 'zod'

export const classroomDataPrivacyClassSchema = z.enum([
  'teacher_content',
  'student_identity',
  'student_work',
  'grades_and_feedback',
  'behavioral_telemetry',
  'external_reference',
  'operations',
])

export type ClassroomDataPrivacyClass = z.infer<typeof classroomDataPrivacyClassSchema>

export const gradexDispositionSchema = z.enum(['exclude', 'include_structured'])
export type GradexDisposition = z.infer<typeof gradexDispositionSchema>

const rootScopeSchema = z.object({
  kind: z.literal('root'),
}).strict()

const foreignKeyScopeSchema = z.object({
  kind: z.literal('foreign_key'),
  parent: z.string().min(1),
  column: z.string().min(1),
}).strict()

export const classroomResourceSchema = z.object({
  table: z.string().min(1),
  primary_key: z.array(z.string().min(1)).min(1),
  actor_columns: z.array(z.string().min(1)),
  scope: z.discriminatedUnion('kind', [rootScopeSchema, foreignKeyScopeSchema]),
  restore_after: z.array(z.string().min(1)),
  privacy: z.array(classroomDataPrivacyClassSchema).min(1),
  archive: z.literal('include'),
  gradex: gradexDispositionSchema,
}).strict()

export type ClassroomResource = z.infer<typeof classroomResourceSchema>

export const CLASSROOM_ACTOR_REFERENCE_COLUMNS = {
  announcement_reads: ['user_id'],
  announcements: ['created_by'],
  assessment_drafts: ['created_by', 'updated_by'],
  assignment_ai_grading_run_items: ['student_id'],
  assignment_ai_grading_runs: ['triggered_by'],
  assignment_docs: ['student_id'],
  assignment_feedback_entries: ['created_by', 'student_id'],
  assignment_repo_review_results: ['student_id'],
  assignment_repo_review_runs: ['triggered_by'],
  assignment_repo_targets: ['student_id'],
  assignment_submission_artifacts: ['student_id'],
  assignments: ['created_by'],
  classroom_enrollments: ['student_id'],
  classroom_retired_assessment_record_actors: ['actor_id'],
  classroom_resources: ['updated_by'],
  classrooms: ['teacher_id'],
  classwork_materials: ['created_by'],
  entries: ['student_id'],
  quiz_responses: ['student_id'],
  quiz_student_scores: ['student_id'],
  quizzes: ['created_by'],
  report_card_rows: ['student_id'],
  report_cards: ['created_by'],
  survey_responses: ['student_id'],
  surveys: ['created_by'],
  test_ai_grading_run_items: ['student_id'],
  test_ai_grading_runs: ['triggered_by'],
  test_attempts: ['closed_for_grading_by', 'returned_by', 'student_id'],
  test_focus_events: ['student_id'],
  test_responses: ['graded_by', 'student_id'],
  test_student_availability: ['student_id', 'updated_by'],
  tests: ['created_by'],
} as const satisfies Record<string, readonly string[]>

export const classroomResourceInventorySchema = z.array(classroomResourceSchema).min(1).superRefine(
  (resources, context) => {
    const resourcesByTable = new Map<string, ClassroomResource>()

    for (const [index, resource] of resources.entries()) {
      if (resourcesByTable.has(resource.table)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate classroom resource: ${resource.table}`,
          path: [index, 'table'],
        })
      }
      resourcesByTable.set(resource.table, resource)
    }

    const roots = resources.filter((resource) => resource.scope.kind === 'root')
    if (roots.length !== 1 || roots[0]?.table !== 'classrooms') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'The classroom resource graph must have classrooms as its only root',
      })
    }

    for (const [index, resource] of resources.entries()) {
      const dependencies = new Set(resource.restore_after)
      if (dependencies.size !== resource.restore_after.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate restore dependency for ${resource.table}`,
          path: [index, 'restore_after'],
        })
      }
      if (resource.scope.kind === 'root' && dependencies.size > 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'The root resource cannot have restore dependencies',
          path: [index, 'restore_after'],
        })
      }
      if (
        resource.scope.kind === 'foreign_key' &&
        !dependencies.has(resource.scope.parent)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Selection parent ${resource.scope.parent} must be a restore dependency`,
          path: [index, 'restore_after'],
        })
      }
      for (const dependency of dependencies) {
        if (!resourcesByTable.has(dependency)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Missing restore dependency: ${dependency}`,
            path: [index, 'restore_after'],
          })
        }
      }
    }

    const visiting = new Set<string>()
    const visited = new Set<string>()
    function visit(table: string) {
      if (visited.has(table)) return
      if (visiting.has(table)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Cycle in classroom resource graph at ${table}`,
        })
        return
      }

      const current = resourcesByTable.get(table)
      if (!current) return
      visiting.add(table)
      for (const dependency of current.restore_after) {
        if (resourcesByTable.has(dependency)) {
          if (visiting.has(dependency)) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Cycle in classroom resource graph at ${dependency}`,
            })
          } else {
            visit(dependency)
          }
        }
      }
      visiting.delete(table)
      visited.add(table)
    }

    for (const resource of resources) {
      visit(resource.table)
    }
  },
)

function resource<const Table extends string>(
  table: Table,
  parent: string | null,
  column: string | null,
  privacy: ClassroomDataPrivacyClass[],
  gradex: GradexDisposition = 'exclude',
  additionalRestoreDependencies: string[] = [],
  primaryKey: string[] = ['id'],
): ClassroomResource & { table: Table } {
  const actorColumns = CLASSROOM_ACTOR_REFERENCE_COLUMNS[
    table as keyof typeof CLASSROOM_ACTOR_REFERENCE_COLUMNS
  ] || []
  return {
    table,
    primary_key: primaryKey,
    actor_columns: [...actorColumns],
    scope: parent && column
      ? { kind: 'foreign_key', parent, column }
      : { kind: 'root' },
    restore_after: parent
      ? [parent, ...additionalRestoreDependencies]
      : [],
    privacy,
    archive: 'include',
    gradex,
  }
}

export const CLASSROOM_RELATIONAL_RESOURCES = [
  resource('classrooms', null, null, ['teacher_content', 'operations']),
  resource('announcements', 'classrooms', 'classroom_id', ['teacher_content']),
  resource('announcement_reads', 'announcements', 'announcement_id', ['student_identity', 'operations']),
  resource('assessment_drafts', 'classrooms', 'classroom_id', ['teacher_content', 'operations']),
  resource('assignments', 'classrooms', 'classroom_id', ['teacher_content'], 'include_structured'),
  resource('assignment_ai_grading_runs', 'assignments', 'assignment_id', ['grades_and_feedback', 'operations'], 'include_structured'),
  resource('assignment_ai_grading_run_items', 'assignment_ai_grading_runs', 'run_id', ['student_identity', 'grades_and_feedback', 'operations'], 'include_structured', ['assignment_docs', 'assignments']),
  resource('assignment_docs', 'assignments', 'assignment_id', ['student_identity', 'student_work', 'grades_and_feedback'], 'include_structured'),
  resource('assignment_doc_history', 'assignment_docs', 'assignment_doc_id', ['student_work', 'operations']),
  resource('assignment_feedback_entries', 'assignments', 'assignment_id', ['student_identity', 'grades_and_feedback'], 'include_structured'),
  resource('assignment_repo_review_runs', 'assignments', 'assignment_id', ['grades_and_feedback', 'operations'], 'include_structured'),
  resource('assignment_repo_review_results', 'assignment_repo_review_runs', 'run_id', ['student_identity', 'grades_and_feedback', 'operations'], 'include_structured', ['assignments']),
  resource('assignment_repo_targets', 'assignments', 'assignment_id', ['student_identity', 'external_reference']),
  resource('assignment_submission_requirements', 'assignments', 'assignment_id', ['teacher_content'], 'include_structured'),
  resource('assignment_submission_artifacts', 'assignment_docs', 'assignment_doc_id', ['student_identity', 'student_work', 'external_reference'], 'exclude', ['assignment_submission_requirements']),
  resource('class_days', 'classrooms', 'classroom_id', ['teacher_content', 'operations']),
  resource('classroom_enrollments', 'classrooms', 'classroom_id', ['student_identity']),
  resource('classroom_resources', 'classrooms', 'classroom_id', ['teacher_content']),
  resource('classroom_roster', 'classrooms', 'classroom_id', ['student_identity']),
  resource('classwork_materials', 'classrooms', 'classroom_id', ['teacher_content']),
  resource('entries', 'classrooms', 'classroom_id', ['student_identity', 'student_work']),
  resource('gradebook_settings', 'classrooms', 'classroom_id', ['teacher_content', 'grades_and_feedback'], 'exclude', [], ['classroom_id']),
  resource('lesson_plans', 'classrooms', 'classroom_id', ['teacher_content']),
  resource('log_summaries', 'classrooms', 'classroom_id', ['student_work', 'operations']),
  resource('quizzes', 'classrooms', 'classroom_id', ['teacher_content', 'grades_and_feedback']),
  resource('quiz_questions', 'quizzes', 'quiz_id', ['teacher_content']),
  resource('quiz_responses', 'quizzes', 'quiz_id', ['student_identity', 'student_work', 'grades_and_feedback'], 'exclude', ['quiz_questions']),
  resource('quiz_student_scores', 'quizzes', 'quiz_id', ['student_identity', 'grades_and_feedback']),
  resource('report_cards', 'classrooms', 'classroom_id', ['teacher_content', 'grades_and_feedback']),
  resource('report_card_rows', 'report_cards', 'report_card_id', ['student_identity', 'grades_and_feedback']),
  resource('surveys', 'classrooms', 'classroom_id', ['teacher_content']),
  resource('survey_questions', 'surveys', 'survey_id', ['teacher_content']),
  resource('survey_responses', 'surveys', 'survey_id', ['student_identity', 'student_work'], 'exclude', ['survey_questions']),
  resource('tests', 'classrooms', 'classroom_id', ['teacher_content'], 'include_structured'),
  resource('test_ai_grading_runs', 'tests', 'test_id', ['grades_and_feedback', 'operations'], 'include_structured'),
  resource('test_ai_grading_run_items', 'test_ai_grading_runs', 'run_id', ['student_identity', 'grades_and_feedback', 'operations'], 'include_structured', ['test_questions', 'test_responses', 'tests']),
  resource('test_attempts', 'tests', 'test_id', ['student_identity', 'student_work', 'grades_and_feedback', 'operations']),
  resource('test_attempt_history', 'test_attempts', 'test_attempt_id', ['student_identity', 'student_work', 'grades_and_feedback', 'operations']),
  resource('test_focus_events', 'tests', 'test_id', ['student_identity', 'behavioral_telemetry']),
  resource('test_questions', 'tests', 'test_id', ['teacher_content'], 'include_structured'),
  resource('test_responses', 'tests', 'test_id', ['student_identity', 'student_work', 'grades_and_feedback'], 'include_structured', ['test_questions']),
  resource('test_student_availability', 'tests', 'test_id', ['student_identity', 'operations']),
  resource('classroom_retired_assessment_records', 'classrooms', 'classroom_id', ['teacher_content', 'student_identity', 'student_work', 'grades_and_feedback', 'operations']),
  resource('classroom_retired_assessment_record_actors', 'classroom_retired_assessment_records', 'record_id', ['student_identity']),
] as const satisfies readonly ClassroomResource[]

export type ClassroomResourceTable = (typeof CLASSROOM_RELATIONAL_RESOURCES)[number]['table']

classroomResourceInventorySchema.parse(CLASSROOM_RELATIONAL_RESOURCES)

export const GRADEX_RESOURCE_TABLES = CLASSROOM_RELATIONAL_RESOURCES
  .filter((resource) => resource.gradex === 'include_structured')
  .map((resource) => resource.table)
  .sort()

export type ClassroomSchemaRelationship = {
  child_table: string
  parent_table: string
  child_columns: string[]
}

export type ClassroomSchemaPrimaryKey = {
  table_name: string
  columns: string[]
}

export type ClassroomResourceSchemaAudit = {
  ok: boolean
  untracked_tables: string[]
  stale_tables: string[]
  missing_restore_dependencies: string[]
  invalid_selection_scopes: string[]
  invalid_primary_keys: string[]
  untracked_actor_references: string[]
  stale_actor_references: string[]
}

export function auditClassroomResourceSchema(
  relationships: ClassroomSchemaRelationship[],
  primaryKeys: ClassroomSchemaPrimaryKey[],
): ClassroomResourceSchemaAudit {
  const descendants = new Set(['classrooms'])
  let changed = true

  while (changed) {
    changed = false
    for (const relationship of relationships) {
      if (
        descendants.has(relationship.parent_table) &&
        !descendants.has(relationship.child_table)
      ) {
        descendants.add(relationship.child_table)
        changed = true
      }
    }
  }

  const resourcesByTable = new Map<string, ClassroomResource>(
    CLASSROOM_RELATIONAL_RESOURCES.map((item) => [item.table, item]),
  )
  const contractTables = new Set<string>(resourcesByTable.keys())
  const untrackedTables = Array.from(descendants)
    .filter((table) => !contractTables.has(table))
    .sort()
  const staleTables = Array.from(contractTables)
    .filter((table) => !descendants.has(table))
    .sort()
  const missingRestoreDependencies: string[] = []

  for (const relationship of relationships) {
    if (
      relationship.child_table === 'classrooms' ||
      relationship.child_table === relationship.parent_table ||
      !descendants.has(relationship.child_table) ||
      !descendants.has(relationship.parent_table)
    ) {
      continue
    }

    const resource = resourcesByTable.get(relationship.child_table)
    if (resource && !resource.restore_after.includes(relationship.parent_table)) {
      missingRestoreDependencies.push(
        `${relationship.child_table}->${relationship.parent_table}`,
      )
    }
  }

  const invalidSelectionScopes = CLASSROOM_RELATIONAL_RESOURCES.flatMap((resource) => {
    const scope = resource.scope
    if (scope.kind === 'root') return []

    const relationship = relationships.find((candidate) =>
      candidate.child_table === resource.table &&
      candidate.parent_table === scope.parent &&
      candidate.child_columns.includes(scope.column),
    )

    return relationship
      ? []
      : [`${resource.table}.${scope.column}->${scope.parent}`]
  })
  const primaryKeysByTable = new Map(
    primaryKeys.map((primaryKey) => [primaryKey.table_name, primaryKey.columns]),
  )
  const invalidPrimaryKeys = CLASSROOM_RELATIONAL_RESOURCES.flatMap((resource) => {
    const actual = primaryKeysByTable.get(resource.table)
    return actual &&
      actual.length === resource.primary_key.length &&
      actual.every((column, index) => column === resource.primary_key[index])
      ? []
      : [`${resource.table}: expected (${resource.primary_key.join(',')}) got (${actual?.join(',') || 'none'})`]
  })
  const actualActorReferences = new Set(
    relationships
      .filter((relationship) =>
        relationship.parent_table === 'users' && contractTables.has(relationship.child_table),
      )
      .flatMap((relationship) =>
        relationship.child_columns.map((column) => `${relationship.child_table}.${column}`),
      ),
  )
  const expectedActorReferences = new Set(
    CLASSROOM_RELATIONAL_RESOURCES.flatMap((resource) =>
      resource.actor_columns.map((column) => `${resource.table}.${column}`),
    ),
  )
  const untrackedActorReferences = [...actualActorReferences]
    .filter((reference) => !expectedActorReferences.has(reference))
    .sort()
  const staleActorReferences = [...expectedActorReferences]
    .filter((reference) => !actualActorReferences.has(reference))
    .sort()

  const uniqueMissingDependencies = Array.from(new Set(missingRestoreDependencies)).sort()
  return {
    ok:
      untrackedTables.length === 0 &&
      staleTables.length === 0 &&
      uniqueMissingDependencies.length === 0 &&
      invalidSelectionScopes.length === 0 &&
      invalidPrimaryKeys.length === 0 &&
      untrackedActorReferences.length === 0 &&
      staleActorReferences.length === 0,
    untracked_tables: untrackedTables,
    stale_tables: staleTables,
    missing_restore_dependencies: uniqueMissingDependencies,
    invalid_selection_scopes: invalidSelectionScopes.sort(),
    invalid_primary_keys: invalidPrimaryKeys.sort(),
    untracked_actor_references: untrackedActorReferences,
    stale_actor_references: staleActorReferences,
  }
}

export function getClassroomResourceOrder(
  direction: 'export' | 'restore' | 'purge',
): ClassroomResourceTable[] {
  const ordered: ClassroomResourceTable[] = []
  const remaining = new Map(
    CLASSROOM_RELATIONAL_RESOURCES.map((item) => [item.table, item]),
  )

  while (remaining.size > 0) {
    const restored = new Set<string>(ordered)
    const ready = Array.from(remaining.values()).filter((item) =>
      item.restore_after.every((dependency) => restored.has(dependency)),
    )

    if (ready.length === 0) {
      throw new Error('Classroom resource graph cannot be ordered')
    }

    for (const item of ready) {
      ordered.push(item.table)
      remaining.delete(item.table)
    }
  }

  return direction === 'purge' ? ordered.reverse() : ordered
}
