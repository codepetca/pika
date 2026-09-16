/**
 * Offline A/B for assignment score anchors.
 *
 * Grades the same submissions twice — once with the current unanchored prompt,
 * once with generated anchors — and reports the score spread for each, so the
 * anchor rollout can be judged on evidence instead of impression.
 *
 * Usage:
 *   pnpm eval:assignment-anchors ppz3c A1          # read one assignment
 *   pnpm eval:assignment-anchors ppz3c A1 --show   # print the payload, no API calls
 *   pnpm eval:assignment-anchors sample.json       # read a prepared file
 *
 * Reading from the database builds the exact sanitized strings that grading
 * sends: the same instruction extraction, the same submission text, the same
 * attached artifacts, and the same roster-aware sanitization. Nothing is
 * written back. Use --show first to see precisely what would leave the machine.
 *
 * A prepared file is { assignmentTitle, instructions, submissions: [{label, text}] }.
 */
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import {
  buildAssignmentGradingRequest,
  generateAssignmentAnchors,
  gradeStudentWork,
  isAssignmentGradingAnchorsEnabled,
} from '@/lib/ai-grading'
import { getAssignmentInstructionsMarkdown } from '@/lib/assignment-instructions'
import { limitedMarkdownToPlainText } from '@/lib/limited-markdown'
import { loadClassroomAiSanitizationContext } from '@/lib/server/ai-sanitization'
import { loadAssignmentSubmissionArtifactsForDoc } from '@/lib/server/assignment-submission-artifacts'
import { submissionArtifactsToAssignmentArtifacts } from '@/lib/assignment-submission-requirements'
import type { AssignmentGradingAnchors } from '@/lib/grading/profiles/pika-assignment-anchors'
import { getServiceRoleClient } from '@/lib/supabase'
import type { TiptapContent } from '@/types'

const CRITERIA = ['completion', 'thinking', 'workflow'] as const
type Criterion = (typeof CRITERIA)[number]
type Scores = Record<Criterion, number>

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const sampleSchema = z.object({
  assignmentTitle: z.string().min(1),
  instructions: z.string().min(1),
  submissions: z.array(z.object({
    label: z.string().min(1),
    text: z.string().min(1),
  })).min(2),
})

type Sample = z.infer<typeof sampleSchema>

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

const ASSIGNMENT_COLUMNS = 'id, title, classroom_id, instructions_markdown, rich_instructions'

async function loadFromDatabase(args: string[]): Promise<Sample | null> {
  const supabase = getServiceRoleClient()

  let assignment
  if (UUID_PATTERN.test(args[0])) {
    const { data } = await supabase
      .from('assignments').select(ASSIGNMENT_COLUMNS).eq('id', args[0]).single()
    if (!data) {
      console.error(`No assignment with id ${args[0]}.`)
      return null
    }
    assignment = data
  } else {
    const [classCode, title] = args
    if (!title) {
      console.error('Give a class code and an assignment title, e.g. ppz3c A1.')
      return null
    }
    const { data: classroom } = await supabase
      .from('classrooms').select('id').ilike('class_code', classCode).maybeSingle()
    if (!classroom) {
      console.error(`No classroom with class code ${classCode}.`)
      return null
    }
    const { data: matches } = await supabase
      .from('assignments').select(ASSIGNMENT_COLUMNS)
      .eq('classroom_id', classroom.id).ilike('title', title)
    if (!matches?.length) {
      const { data: available } = await supabase
        .from('assignments').select('title').eq('classroom_id', classroom.id).order('position')
      console.error(`No assignment titled "${title}" in ${classCode}.`)
      if (available?.length) {
        console.error(`Assignments here: ${available.map((row) => row.title).join(', ')}`)
      }
      return null
    }
    if (matches.length > 1) {
      console.error(`"${title}" is ambiguous in ${classCode}. Re-run with an id:`)
      for (const match of matches) console.error(`  ${match.id}`)
      return null
    }
    assignment = matches[0]
  }

  const { data: docs } = await supabase
    .from('assignment_docs')
    .select('id, content, updated_at')
    .eq('assignment_id', assignment.id)
    .order('updated_at', { ascending: true })

  const sanitizationContext = await loadClassroomAiSanitizationContext(
    supabase,
    assignment.classroom_id,
  )
  const instructions = limitedMarkdownToPlainText(
    getAssignmentInstructionsMarkdown(assignment).markdown,
  )

  const submissions: Sample['submissions'] = []
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
    submissions.push({
      label: `student-${String(submissions.length + 1).padStart(2, '0')}`,
      text: request.input.submission,
    })
  }

  if (submissions.length < 2) {
    console.error(`Need at least 2 non-empty submissions, found ${submissions.length}.`)
    return null
  }

  const header = buildAssignmentGradingRequest({
    assignmentTitle: assignment.title,
    instructions,
    studentWork: asDoc('placeholder'),
    sanitizationContext,
  })

  return {
    assignmentTitle: header.input.assignmentTitle,
    instructions: header.input.instructions,
    submissions,
  }
}

function describe(values: number[]): string {
  if (values.length === 0) return 'n/a'
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  return [
    `mean ${mean.toFixed(2)}`,
    `sd ${Math.sqrt(variance).toFixed(2)}`,
    `range ${Math.min(...values)}-${Math.max(...values)}`,
    `distinct ${new Set(values).size}`,
  ].join('  ')
}

async function gradeAll(
  sample: Sample,
  anchors: AssignmentGradingAnchors | null,
): Promise<Map<string, Scores>> {
  const results = new Map<string, Scores>()
  for (const submission of sample.submissions) {
    const grade = await gradeStudentWork({
      assignmentTitle: sample.assignmentTitle,
      instructions: sample.instructions,
      studentWork: asDoc(submission.text),
      anchors,
    })
    results.set(submission.label, {
      completion: grade.score_completion,
      thinking: grade.score_thinking,
      workflow: grade.score_workflow,
    })
  }
  return results
}

function totalOf(scores: Scores): number {
  return CRITERIA.reduce((sum, criterion) => sum + scores[criterion], 0)
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const showOnly = argv.includes('--show')
  const args = argv.filter((arg) => arg !== '--show')
  if (args.length === 0) {
    console.error('Usage: pnpm eval:assignment-anchors <class-code> <title> [--show]')
    console.error('   or: pnpm eval:assignment-anchors <sample.json>')
    process.exitCode = 1
    return
  }

  const sample = args[0].endsWith('.json')
    ? sampleSchema.parse(JSON.parse(readFileSync(args[0], 'utf8')))
    : await loadFromDatabase(args)
  if (!sample) {
    process.exitCode = 1
    return
  }

  if (showOnly) {
    console.log('=== Exactly what grading would send ===\n')
    console.log(`Assignment: ${sample.assignmentTitle}`)
    console.log(`Instructions:\n${sample.instructions}\n`)
    for (const submission of sample.submissions) {
      console.log(`--- ${submission.label} ---`)
      console.log(`${submission.text}\n`)
    }
    console.log('No API calls were made. Drop --show to run the evaluation.')
    return
  }

  if (!isAssignmentGradingAnchorsEnabled()) {
    console.error('Set ASSIGNMENT_GRADING_ANCHORS_ENABLED=true to run the anchored arm.')
    process.exitCode = 1
    return
  }

  console.log(`Assignment: ${sample.assignmentTitle}`)
  console.log(`Submissions: ${sample.submissions.length}\n`)

  const generated = await generateAssignmentAnchors({
    assignmentTitle: sample.assignmentTitle,
    instructions: sample.instructions,
  })
  if (generated.thinInstructions) {
    console.log('WARNING: instructions are short. Anchors are largely guesswork here.\n')
  }
  for (const criterion of generated.anchors.criteria) {
    console.log(`${criterion.label}`)
    for (const band of criterion.bands) {
      console.log(`  ${band.minScore}-${band.maxScore}: ${band.descriptor}`)
    }
    console.log('')
  }
  if (generated.anchors.notes) {
    console.log(`Model notes: ${generated.anchors.notes}\n`)
  }

  const baseline = await gradeAll(sample, null)
  const anchored = await gradeAll(sample, generated.anchors)

  console.log('Per-criterion spread')
  for (const criterion of CRITERIA) {
    const before = [...baseline.values()].map((scores) => scores[criterion])
    const after = [...anchored.values()].map((scores) => scores[criterion])
    console.log(`  ${criterion.padEnd(12)} baseline   ${describe(before)}`)
    console.log(`  ${''.padEnd(12)} anchored   ${describe(after)}`)
  }

  console.log('\nTotal out of 30')
  console.log(`  baseline   ${describe([...baseline.values()].map(totalOf))}`)
  console.log(`  anchored   ${describe([...anchored.values()].map(totalOf))}`)

  console.log('\nPer submission (total, baseline -> anchored)')
  for (const submission of sample.submissions) {
    const before = totalOf(baseline.get(submission.label)!)
    const after = totalOf(anchored.get(submission.label)!)
    console.log(
      `  ${submission.label.padEnd(14)} ${before} -> ${after}` +
      `  (${after - before >= 0 ? '+' : ''}${after - before})`,
    )
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Assignment anchor evaluation failed')
  process.exitCode = 1
})
