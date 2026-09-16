/**
 * Offline A/B for assignment score anchors.
 *
 * Grades the same submissions twice — once with the current unanchored prompt,
 * once with generated anchors — and reports the score spread for each, so the
 * anchor rollout can be judged on evidence instead of impression.
 *
 * Usage:
 *   pnpm eval:assignment-anchors <sample-file.json>
 *
 * The sample file holds only text you are willing to send to the grading
 * provider. It never reads Pika's database, so de-identify it yourself:
 *
 * {
 *   "assignmentTitle": "A1 Portfolio Site",
 *   "instructions": "Full assignment instructions ...",
 *   "submissions": [
 *     { "label": "student-a", "text": "..." },
 *     { "label": "student-b", "text": "..." }
 *   ]
 * }
 */
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import {
  generateAssignmentAnchors,
  gradeStudentWork,
  isAssignmentGradingAnchorsEnabled,
} from '@/lib/ai-grading'
import type { AssignmentGradingAnchors } from '@/lib/grading/profiles/pika-assignment-anchors'
import type { TiptapContent } from '@/types'

const CRITERIA = ['completion', 'thinking', 'workflow'] as const
type Criterion = (typeof CRITERIA)[number]

const sampleSchema = z.object({
  assignmentTitle: z.string().min(1),
  instructions: z.string().min(1),
  submissions: z.array(z.object({
    label: z.string().min(1),
    text: z.string().min(1),
  })).min(2),
})

type Scores = Record<Criterion, number>

function asDoc(text: string): TiptapContent {
  return {
    type: 'doc',
    content: text.split('\n\n').map((paragraph) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: paragraph }],
    })),
  } as TiptapContent
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
  sample: z.infer<typeof sampleSchema>,
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
  const samplePath = process.argv[2]
  if (!samplePath) {
    console.error('Usage: pnpm eval:assignment-anchors <sample-file.json>')
    process.exitCode = 1
    return
  }
  if (!isAssignmentGradingAnchorsEnabled()) {
    console.error('Set ASSIGNMENT_GRADING_ANCHORS_ENABLED=true to run the anchored arm.')
    process.exitCode = 1
    return
  }

  const sample = sampleSchema.parse(JSON.parse(readFileSync(samplePath, 'utf8')))

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
  console.log('  criterion    arm        stats')
  for (const criterion of CRITERIA) {
    const before = [...baseline.values()].map((scores) => scores[criterion])
    const after = [...anchored.values()].map((scores) => scores[criterion])
    console.log(`  ${criterion.padEnd(12)} baseline   ${describe(before)}`)
    console.log(`  ${''.padEnd(12)} anchored   ${describe(after)}`)
  }

  const baselineTotals = [...baseline.values()].map(totalOf)
  const anchoredTotals = [...anchored.values()].map(totalOf)
  console.log('\nTotal out of 30')
  console.log(`  baseline   ${describe(baselineTotals)}`)
  console.log(`  anchored   ${describe(anchoredTotals)}`)

  console.log('\nPer submission (total, baseline -> anchored)')
  for (const submission of sample.submissions) {
    const before = baseline.get(submission.label)!
    const after = anchored.get(submission.label)!
    const delta = totalOf(after) - totalOf(before)
    console.log(
      `  ${submission.label.padEnd(20)} ${totalOf(before)} -> ${totalOf(after)}` +
      `  (${delta >= 0 ? '+' : ''}${delta})`,
    )
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Assignment anchor evaluation failed')
  process.exitCode = 1
})
