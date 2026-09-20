/**
 * Export a snapshot of one assignment's submissions and existing grades, for
 * offline grading experiments that must not touch production credentials
 * directly.
 *
 * Run this in an environment authorized to hold the production
 * SUPABASE_SECRET_KEY (never paste that key into an AI session). Submission
 * text is processed through Pika's production grading sanitizer
 * (`buildAssignmentGradingRequest` — name-to-initials substitution plus
 * direct-identifier redaction) before it is written here, the same
 * processing already applied before this content reaches a grading
 * provider. That reduces direct identifiers; it is not guaranteed
 * anonymization, and text outside the roster or identifiers embedded in
 * larger words can still remain. Treat the output file as classroom data:
 * keep it private, do not commit it, and do not paste its contents into a
 * chat. Hand the file to `pnpm calibrate:assignment-grading <file>.json
 * <label>`, which needs only DEEPSEEK_API_KEY, not database access.
 *
 * This script performs only SELECT queries. It never calls an AI provider
 * and never writes to the database.
 *
 * Usage:
 *   pnpm export:assignment-grading-snapshot ppz3c A1 ./a1.grading-snapshot.json
 *   pnpm export:assignment-grading-snapshot <assignment-uuid> ./a1.grading-snapshot.json
 *
 * Output files must match `*.grading-snapshot.json` (gitignored) so a
 * snapshot can never be committed by accident. The file is written with
 * owner-only permissions (mode 0600).
 */
import { chmodSync, writeFileSync } from 'node:fs'
import {
  summarizeWorkProcess,
  type WorkProcessHistoryEntry,
  type WorkProcessSummary,
} from '@/lib/assignment-workflow-process'
import {
  buildAssignmentGradingRequest,
} from '@/lib/ai-grading'
import { getAssignmentInstructionsMarkdown } from '@/lib/assignment-instructions'
import { limitedMarkdownToPlainText } from '@/lib/limited-markdown'
import { loadClassroomAiSanitizationContext } from '@/lib/server/ai-sanitization'
import { loadAssignmentSubmissionArtifactsForDoc } from '@/lib/server/assignment-submission-artifacts'
import { submissionArtifactsToAssignmentArtifacts } from '@/lib/assignment-submission-requirements'
import { gradingProvenanceSchema } from '@/lib/grading/contracts'
import { getServiceRoleClient } from '@/lib/supabase'
import type { TiptapContent } from '@/types'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ASSIGNMENT_COLUMNS = 'id, title, classroom_id, due_at, instructions_markdown, rich_instructions'
const DOC_COLUMNS = [
  'id', 'content', 'updated_at', 'is_submitted', 'submitted_at',
  'score_completion', 'score_thinking', 'score_workflow',
  'ai_grading_provenance',
].join(', ')
// Never select `snapshot` or `patch`: they contain student text.
const HISTORY_COLUMNS = 'word_count, paste_word_count, trigger, created_at'

function asDoc(text: string): TiptapContent {
  return {
    type: 'doc',
    content: text.split('\n\n').map((paragraph) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: paragraph }],
    })),
  } as TiptapContent
}

function parseContent(raw: unknown): TiptapContent {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as TiptapContent
    } catch {
      return { type: 'doc', content: [] } as TiptapContent
    }
  }
  return (raw ?? { type: 'doc', content: [] }) as TiptapContent
}

// Only the fields the offline evaluation actually compares against. Token
// counts, provider request identifiers, and other run metadata are dropped.
interface ProvenanceSummary {
  provider: string
  model: string
  policyVersion: string
  promptVersion: string
  gradingProfileVersion: string
  rubricVersion: string
}

interface ExistingGrade {
  scoreCompletion: number | null
  scoreThinking: number | null
  scoreWorkflow: number | null
  aiProvenance: ProvenanceSummary | null
}

interface SnapshotSubmission {
  label: string
  text: string
  existingGrade: ExistingGrade | null
  // Derived numbers only; no timestamps or content leave the export.
  process: WorkProcessSummary
}


interface Snapshot {
  assignmentTitle: string
  instructions: string
  exportedAt: string
  submissions: SnapshotSubmission[]
}

function summarizeProvenance(raw: unknown): ProvenanceSummary | null {
  if (!raw) return null
  const parsed = gradingProvenanceSchema.safeParse(raw)
  if (!parsed.success) return null
  const { provider, model, policyVersion, promptVersion, gradingProfileVersion, rubricVersion } = parsed.data
  return { provider, model, policyVersion, promptVersion, gradingProfileVersion, rubricVersion }
}

async function resolveAssignment(args: string[]) {
  const supabase = getServiceRoleClient()

  if (UUID_PATTERN.test(args[0])) {
    const { data, error } = await supabase
      .from('assignments').select(ASSIGNMENT_COLUMNS).eq('id', args[0]).single()
    if (error) {
      console.error(`Assignment lookup failed: ${error.message}`)
      return null
    }
    if (!data) {
      console.error(`No assignment with id ${args[0]}.`)
      return null
    }
    return { supabase, assignment: data }
  }

  const [classCode, title] = args
  if (!title) {
    console.error('Give a class code and an assignment title, e.g. ppz3c A1.')
    return null
  }
  const { data: classroom, error: classroomError } = await supabase
    .from('classrooms').select('id').ilike('class_code', classCode).maybeSingle()
  if (classroomError) {
    console.error(`Classroom lookup failed: ${classroomError.message}`)
    return null
  }
  if (!classroom) {
    console.error(`No classroom with class code ${classCode}.`)
    return null
  }
  const { data: matches, error: matchesError } = await supabase
    .from('assignments').select(ASSIGNMENT_COLUMNS)
    .eq('classroom_id', classroom.id).ilike('title', title)
  if (matchesError) {
    console.error(`Assignment lookup failed: ${matchesError.message}`)
    return null
  }
  if (!matches?.length) {
    console.error(`No assignment titled "${title}" in ${classCode}.`)
    return null
  }
  if (matches.length > 1) {
    console.error(`"${title}" is ambiguous in ${classCode}. Re-run with an id:`)
    for (const match of matches) console.error(`  ${match.id}`)
    return null
  }
  return { supabase, assignment: matches[0] }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.length < 2) {
    console.error('Usage: pnpm export:assignment-grading-snapshot <class-code> <title> <out-file>')
    console.error('   or: pnpm export:assignment-grading-snapshot <assignment-uuid> <out-file>')
    process.exitCode = 1
    return
  }

  const outPath = argv[argv.length - 1]
  const args = argv.slice(0, -1)
  if (!outPath.endsWith('.grading-snapshot.json')) {
    console.error('Output file must end with .grading-snapshot.json (that suffix is gitignored).')
    process.exitCode = 1
    return
  }

  const resolved = await resolveAssignment(args)
  if (!resolved) {
    process.exitCode = 1
    return
  }
  const { supabase, assignment } = resolved

  const { data: docs, error: docsError } = await supabase
    .from('assignment_docs')
    .select(DOC_COLUMNS)
    .eq('assignment_id', assignment.id)
    .order('updated_at', { ascending: true })
  if (docsError) {
    console.error(`Failed to load submissions: ${docsError.message}`)
    process.exitCode = 1
    return
  }

  const sanitizationContext = await loadClassroomAiSanitizationContext(
    supabase,
    assignment.classroom_id,
  )
  const instructions = limitedMarkdownToPlainText(
    getAssignmentInstructionsMarkdown(assignment).markdown,
  )

  const submissions: SnapshotSubmission[] = []
  for (const doc of docs ?? []) {
    const artifacts = submissionArtifactsToAssignmentArtifacts(
      await loadAssignmentSubmissionArtifactsForDoc(supabase, doc.id),
    )
    let request
    try {
      // The single source of truth for what grading actually sends.
      request = buildAssignmentGradingRequest({
        assignmentTitle: assignment.title,
        instructions,
        studentWork: parseContent(doc.content),
        submissionArtifacts: artifacts,
        sanitizationContext,
      })
    } catch {
      continue // empty submission
    }

    const { data: history, error: historyError } = await supabase
      .from('assignment_doc_history')
      .select(HISTORY_COLUMNS)
      .eq('assignment_doc_id', doc.id)
      .order('created_at', { ascending: true })
    if (historyError) {
      console.error(`Failed to load save history: ${historyError.message}`)
      process.exitCode = 1
      return
    }

    const hasExistingGrade = doc.score_completion !== null
      || doc.score_thinking !== null
      || doc.score_workflow !== null

    submissions.push({
      label: `student-${String(submissions.length + 1).padStart(2, '0')}`,
      text: request.input.submission,
      existingGrade: hasExistingGrade ? {
        scoreCompletion: doc.score_completion,
        scoreThinking: doc.score_thinking,
        scoreWorkflow: doc.score_workflow,
        // AI grading stamps graded_by with the triggering teacher, so there is
        // no reliable signal that a human changed this grade.
        aiProvenance: summarizeProvenance(doc.ai_grading_provenance),
      } : null,
      process: summarizeWorkProcess((history ?? []) as WorkProcessHistoryEntry[], {
        dueAt: assignment.due_at,
        isSubmitted: doc.is_submitted,
        submittedAt: doc.submitted_at,
      }),
    })
  }

  if (submissions.length < 2) {
    console.error(`Need at least 2 non-empty submissions, found ${submissions.length}.`)
    process.exitCode = 1
    return
  }

  // Same sanitized header grading itself builds — mirrors the pattern in
  // eval-assignment-anchors.ts so the two scripts agree on what "the
  // assignment header" means.
  const header = buildAssignmentGradingRequest({
    assignmentTitle: assignment.title,
    instructions,
    studentWork: asDoc('placeholder'),
    sanitizationContext,
  })

  const snapshot: Snapshot = {
    assignmentTitle: header.input.assignmentTitle,
    instructions: header.input.instructions,
    exportedAt: new Date().toISOString(),
    submissions,
  }

  writeFileSync(outPath, JSON.stringify(snapshot, null, 2), { mode: 0o600 })
  // writeFileSync only applies `mode` when creating a new file; force it in
  // case outPath already existed with looser permissions.
  chmodSync(outPath, 0o600)

  const withGrades = submissions.filter((s) => s.existingGrade !== null).length
  console.log(`Wrote ${submissions.length} submissions to ${outPath} (mode 0600).`)
  console.log(`  ${withGrades} have a grade on record.`)
  console.log('Submission text was processed through Pika\'s production grading sanitizer')
  console.log('(name-to-initials substitution plus direct-identifier redaction) — the same')
  console.log('processing already applied before this content reaches a grading provider.')
  console.log('That is not guaranteed anonymization. Treat this file as classroom data: keep')
  console.log('it private, do not commit it, and do not paste its contents into a chat.')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Snapshot export failed')
  process.exitCode = 1
})
