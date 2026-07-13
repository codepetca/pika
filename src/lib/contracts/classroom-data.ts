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

export const gradexDispositionSchema = z.enum(['exclude', 'include_deidentified'])
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
  scope: z.discriminatedUnion('kind', [rootScopeSchema, foreignKeyScopeSchema]),
  restore_after: z.array(z.string().min(1)),
  privacy: z.array(classroomDataPrivacyClassSchema).min(1),
  archive: z.literal('include'),
  gradex: gradexDispositionSchema,
}).strict()

export type ClassroomResource = z.infer<typeof classroomResourceSchema>

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

function resource(
  table: string,
  parent: string | null,
  column: string | null,
  privacy: ClassroomDataPrivacyClass[],
  gradex: GradexDisposition = 'exclude',
  additionalRestoreDependencies: string[] = [],
): ClassroomResource {
  return {
    table,
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

export const CLASSROOM_RELATIONAL_RESOURCES: ClassroomResource[] = [
  resource('classrooms', null, null, ['teacher_content', 'operations']),
  resource('announcements', 'classrooms', 'classroom_id', ['teacher_content']),
  resource('announcement_reads', 'announcements', 'announcement_id', ['student_identity', 'operations']),
  resource('assessment_drafts', 'classrooms', 'classroom_id', ['teacher_content', 'operations']),
  resource('assignments', 'classrooms', 'classroom_id', ['teacher_content'], 'include_deidentified'),
  resource('assignment_ai_grading_runs', 'assignments', 'assignment_id', ['grades_and_feedback', 'operations'], 'include_deidentified'),
  resource('assignment_ai_grading_run_items', 'assignment_ai_grading_runs', 'run_id', ['student_identity', 'grades_and_feedback', 'operations'], 'include_deidentified', ['assignment_docs', 'assignments']),
  resource('assignment_docs', 'assignments', 'assignment_id', ['student_identity', 'student_work', 'grades_and_feedback'], 'include_deidentified'),
  resource('assignment_doc_history', 'assignment_docs', 'assignment_doc_id', ['student_work', 'operations']),
  resource('assignment_feedback_entries', 'assignments', 'assignment_id', ['student_identity', 'grades_and_feedback'], 'include_deidentified'),
  resource('assignment_repo_review_runs', 'assignments', 'assignment_id', ['grades_and_feedback', 'operations'], 'include_deidentified'),
  resource('assignment_repo_review_results', 'assignment_repo_review_runs', 'run_id', ['student_identity', 'grades_and_feedback', 'operations'], 'include_deidentified', ['assignments']),
  resource('assignment_repo_targets', 'assignments', 'assignment_id', ['student_identity', 'external_reference']),
  resource('assignment_submission_requirements', 'assignments', 'assignment_id', ['teacher_content'], 'include_deidentified'),
  resource('assignment_submission_artifacts', 'assignment_docs', 'assignment_doc_id', ['student_identity', 'student_work', 'external_reference'], 'exclude', ['assignment_submission_requirements']),
  resource('class_days', 'classrooms', 'classroom_id', ['teacher_content', 'operations']),
  resource('classroom_enrollments', 'classrooms', 'classroom_id', ['student_identity']),
  resource('classroom_resources', 'classrooms', 'classroom_id', ['teacher_content']),
  resource('classroom_roster', 'classrooms', 'classroom_id', ['student_identity']),
  resource('classwork_materials', 'classrooms', 'classroom_id', ['teacher_content']),
  resource('entries', 'classrooms', 'classroom_id', ['student_identity', 'student_work']),
  resource('gradebook_settings', 'classrooms', 'classroom_id', ['teacher_content', 'grades_and_feedback']),
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
  resource('tests', 'classrooms', 'classroom_id', ['teacher_content'], 'include_deidentified'),
  resource('test_ai_grading_runs', 'tests', 'test_id', ['grades_and_feedback', 'operations'], 'include_deidentified'),
  resource('test_ai_grading_run_items', 'test_ai_grading_runs', 'run_id', ['student_identity', 'grades_and_feedback', 'operations'], 'include_deidentified', ['test_questions', 'test_responses', 'tests']),
  resource('test_attempts', 'tests', 'test_id', ['student_identity', 'student_work', 'grades_and_feedback', 'operations']),
  resource('test_attempt_history', 'test_attempts', 'test_attempt_id', ['student_identity', 'student_work', 'grades_and_feedback', 'operations']),
  resource('test_focus_events', 'tests', 'test_id', ['student_identity', 'behavioral_telemetry']),
  resource('test_questions', 'tests', 'test_id', ['teacher_content'], 'include_deidentified'),
  resource('test_responses', 'tests', 'test_id', ['student_identity', 'student_work', 'grades_and_feedback'], 'include_deidentified', ['test_questions']),
  resource('test_student_availability', 'tests', 'test_id', ['student_identity', 'operations']),
]

classroomResourceInventorySchema.parse(CLASSROOM_RELATIONAL_RESOURCES)

export const GRADEX_RESOURCE_TABLES = CLASSROOM_RELATIONAL_RESOURCES
  .filter((resource) => resource.gradex === 'include_deidentified')
  .map((resource) => resource.table)
  .sort()

export type ClassroomSchemaRelationship = {
  child_table: string
  parent_table: string
  child_columns: string[]
}

export type ClassroomResourceSchemaAudit = {
  ok: boolean
  untracked_tables: string[]
  stale_tables: string[]
  missing_restore_dependencies: string[]
  invalid_selection_scopes: string[]
}

export function auditClassroomResourceSchema(
  relationships: ClassroomSchemaRelationship[],
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

  const resourcesByTable = new Map(
    CLASSROOM_RELATIONAL_RESOURCES.map((item) => [item.table, item]),
  )
  const contractTables = new Set(resourcesByTable.keys())
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

  const uniqueMissingDependencies = Array.from(new Set(missingRestoreDependencies)).sort()
  return {
    ok:
      untrackedTables.length === 0 &&
      staleTables.length === 0 &&
      uniqueMissingDependencies.length === 0 &&
      invalidSelectionScopes.length === 0,
    untracked_tables: untrackedTables,
    stale_tables: staleTables,
    missing_restore_dependencies: uniqueMissingDependencies,
    invalid_selection_scopes: invalidSelectionScopes.sort(),
  }
}

export function getClassroomResourceOrder(
  direction: 'export' | 'restore' | 'purge',
): string[] {
  const ordered: string[] = []
  const remaining = new Map(
    CLASSROOM_RELATIONAL_RESOURCES.map((item) => [item.table, item]),
  )

  while (remaining.size > 0) {
    const ready = Array.from(remaining.values()).filter((item) =>
      item.restore_after.every((dependency) => ordered.includes(dependency)),
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
