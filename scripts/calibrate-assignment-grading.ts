/**
 * Grade a single submission from an exported grading snapshot with a
 * calibration-only, explainable output: per-criterion evidence, gaps, and
 * confidence, not just a score. This is a teacher calibration tool, not a
 * grading profile — it is never imported by application code and never
 * writes a grade anywhere.
 *
 * Reuses the same rubric text as the production unanchored profile
 * (`pika-assignment.ts`) so the score itself stays faithful to what
 * production grading would say; only the output schema is richer.
 *
 * Grades once with the approved rules from shared.grader-calibration.json
 * and the per-assignment calibration file, matching production's single call.
 * --baseline adds one call without rules for comparison.
 *
 * Usage:
 *   pnpm calibrate:assignment-grading <snapshot.json> <label> [calibration.json] [--baseline]
 *   pnpm calibrate:assignment-grading <snapshot.json> <label> --production
 *
 * --production grades through the shipped profile and process scoring instead,
 * to check that the released code reproduces the calibrated scores.
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import {
  ATTACHED_ARTIFACTS_RULE,
  PIKA_ASSIGNMENT_GRADING_PROFILE,
} from '@/lib/grading/profiles/pika-assignment'
import { buildProcessReminders, scoreWorkflow } from '@/lib/assignment-workflow-process'
import { BLANK_SUBMISSION_MAX_WORDS } from '@/lib/ai-grading'
import type { GradingProfile } from '@/lib/grading/profiles/types'
import { createDeepSeekChatProvider } from '@/lib/grading/providers/deepseek-chat'

const DEFAULT_MODEL = 'deepseek-flash'

const existingGradeSchema = z.object({
  scoreCompletion: z.number().nullable(),
  scoreThinking: z.number().nullable(),
  scoreWorkflow: z.number().nullable(),
}).partial().passthrough()

const processSummarySchema = z.object({
  submitted: z.boolean(),
  daysLate: z.number().nullable(),
  firstSaveDaysBeforeDue: z.number().nullable(),
  workSessions: z.number(),
  daysWithWork: z.number(),
  authenticityScore: z.number().nullable(),
  pastedWords: z.number(),
})

const snapshotSchema = z.object({
  assignmentTitle: z.string().min(1),
  instructions: z.string().min(1),
  submissions: z.array(z.object({
    label: z.string().min(1),
    text: z.string().min(1),
    existingGrade: existingGradeSchema.nullable().optional(),
    process: processSummarySchema.optional(),
  })).min(1),
})

const calibrationRuleSchema = z.object({
  id: z.string(),
  text: z.string(),
  // What the grader is told. Omitted: `text`. Null: code-only rule.
  promptText: z.string().nullable().optional(),
  status: z.enum(['approved', 'rejected', 'proposed', 'superseded']),
})

const calibrationFileSchema = z.object({
  rules: z.array(calibrationRuleSchema).default([]),
  assignmentSettings: z.object({ expectsMultipleSessions: z.boolean() }).partial().optional(),
}).passthrough()

interface CalibrationCriterionOutput {
  criterion_id: 'completion' | 'thinking' | 'workflow'
  score: number
  evidence: string[]
  missing_or_weak: string
  confidence: number
  flags: string[]
}

interface CalibrationOutput {
  criteria: CalibrationCriterionOutput[]
  summary: string
  student_feedback: string
}

const calibrationOutputSchema = z.object({
  criteria: z.array(z.object({
    criterion_id: z.enum(['completion', 'thinking', 'workflow']),
    score: z.number().int().min(0).max(10),
    evidence: z.array(z.string()),
    missing_or_weak: z.string(),
    confidence: z.number().min(0).max(1),
    flags: z.array(z.string()),
  })).length(3),
  summary: z.string().min(1),
  student_feedback: z.string().min(1),
}).strict()

const calibrationJsonSchema = {
  type: 'object',
  properties: {
    criteria: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: {
        type: 'object',
        properties: {
          criterion_id: { type: 'string', enum: ['completion', 'thinking', 'workflow'] },
          score: { type: 'integer', minimum: 0, maximum: 10 },
          evidence: { type: 'array', items: { type: 'string' } },
          missing_or_weak: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          flags: { type: 'array', items: { type: 'string' } },
        },
        required: ['criterion_id', 'score', 'evidence', 'missing_or_weak', 'confidence', 'flags'],
        additionalProperties: false,
      },
    },
    summary: { type: 'string', minLength: 1 },
    student_feedback: { type: 'string', minLength: 1 },
  },
  required: ['criteria', 'summary', 'student_feedback'],
  additionalProperties: false,
} as const

interface CalibrationInput {
  assignmentTitle: string
  instructions: string
  submission: string
  rulesAddendum: string
}

function buildCalibrationProfile(): GradingProfile<CalibrationInput, CalibrationOutput> {
  return {
    id: 'pika-assignment-calibration',
    version: 'calibration-v1',
    promptVersion: 'calibration-prompt-v1',
    rubric: {
      version: PIKA_ASSIGNMENT_GRADING_PROFILE.rubric.version,
      criteria: PIKA_ASSIGNMENT_GRADING_PROFILE.rubric.criteria,
    },
    output: {
      schemaName: 'assignment_grade_calibration',
      jsonSchema: calibrationJsonSchema,
      // DeepSeek's reasoning tokens count against max_tokens, and at the
      // 'high' tier this call maps to, reasoning alone regularly exceeds
      // several thousand tokens before any JSON content is written. This is
      // an interactive, one-submission-at-a-time tool, so the extra
      // headroom costs little.
      initialMaxOutputTokens: 3200,
      fallbackMaxOutputTokens: 6000,
    },
    buildPrompt(input) {
      return {
        systemPrompt: `You are an assignment grader performing a calibration audit for a teacher, not a production grading run. Grade the student's work using this rubric:

- **Completion** (0–10): Did the student complete all parts of the assignment?
- **Thinking** (0–10): Does the work show depth of thought, analysis, or understanding?
- **Workflow** (0–10): Is the work organized, clear, and well-presented?
${ATTACHED_ARTIFACTS_RULE}
- Grade only what the submission actually shows. Do not invent evidence that is not present in the text below.

For each criterion, in addition to the score, report:
- evidence: short quotes or close paraphrases from the submission that support the score (empty array if none)
- missing_or_weak: what evidence is missing or weak that kept the score from being higher (empty string only if the score is already at the top of the scale for a clear reason)
- confidence: your confidence in this score, 0 to 1
- flags: any of "short-submission", "artifact-limitation", "ambiguous-instructions" that apply, or an empty array
${input.rulesAddendum}
Also give a 1-2 sentence "summary" of the overall grade suitable for an audit log, and "student_feedback" addressed to the student, starting with "Strength:" and ending with "Next Step:".`,
        userPrompt: `Assignment: ${input.assignmentTitle}
Instructions: ${input.instructions}

Student Work:
${input.submission}`,
      }
    },
    parseOutput(outputText) {
      const codeBlock = outputText.match(/```(?:json)?\s*([\s\S]*?)```/)
      const jsonText = codeBlock ? codeBlock[1].trim() : outputText
      const parsed: unknown = JSON.parse(jsonText)
      // DeepSeek sometimes wraps the object under a key matching the
      // schema name ("Reply with a single json object named X") instead of
      // returning X's shape directly. Unwrap that one case defensively.
      const candidate = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        && Object.keys(parsed).length === 1 && 'assignment_grade_calibration' in parsed
        ? (parsed as Record<string, unknown>).assignment_grade_calibration
        : parsed
      return calibrationOutputSchema.parse(candidate)
    },
    normalizeOutput(output) {
      return {
        criteria: output.criteria.map((criterion) => ({
          criterionId: criterion.criterion_id,
          score: criterion.score,
          rationale: criterion.missing_or_weak || null,
          evidence: criterion.evidence,
          confidence: criterion.confidence,
          flags: criterion.flags,
        })),
        feedback: { student: output.student_feedback, teacherNotes: output.summary },
      }
    },
  }
}

function getDeepSeekKey(): string | null {
  const key = process.env.DEEPSEEK_API_KEY
  return key?.trim() || null
}

function buildRulesAddendum(rules: string[]): string {
  if (rules.length === 0) return ''
  return `
Additional grading guidance approved by the classroom teacher during calibration. Apply these in addition to the rubric above:
${rules.map((rule) => `- ${rule}`).join('\n')}
`
}

async function runCalibrationGrade(
  input: { assignmentTitle: string; instructions: string; submission: string },
  rules: string[],
  apiKey: string,
) {
  const profile = buildCalibrationProfile()
  const model = process.env.DEEPSEEK_GRADING_MODEL?.trim() || DEFAULT_MODEL
  const provider = createDeepSeekChatProvider({ apiKey })
  const prompt = profile.buildPrompt({ ...input, rulesAddendum: buildRulesAddendum(rules) })
  const response = await provider.generate({
    model,
    systemPrompt: prompt.systemPrompt,
    userPrompt: prompt.userPrompt,
    schemaName: profile.output.schemaName,
    jsonSchema: profile.output.jsonSchema,
    initialMaxOutputTokens: profile.output.initialMaxOutputTokens,
    fallbackMaxOutputTokens: profile.output.fallbackMaxOutputTokens,
    reasoningEffort: 'medium',
  })
  let output: CalibrationOutput
  try {
    output = profile.parseOutput(response.outputText)
  } catch (error) {
    // This tool exists to show submission content directly, so unlike the
    // shared engine it is safe (and necessary for debugging) to surface the
    // raw provider text here rather than swallow it.
    console.error('--- raw provider output (failed to parse) ---')
    console.error(response.outputText)
    console.error('--- end raw provider output ---')
    throw error
  }
  const normalized = profile.normalizeOutput(output)
  return { normalized, tokenUsage: response.tokenUsage, provider: provider.id, model }
}

type CalibrationRule = z.infer<typeof calibrationRuleSchema>

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const withBaseline = argv.includes("--baseline")
  const productionMode = argv.includes("--production")
  const [snapshotPath, label, calibrationPathArg] = argv.filter((arg) => arg !== '--baseline' && arg !== '--production')
  if (!snapshotPath || !label) {
    console.error('Usage: pnpm calibrate:assignment-grading <snapshot.json> <label> [calibration.json] [--baseline]')
    process.exitCode = 1
    return
  }

  const apiKey = getDeepSeekKey()
  if (!apiKey) {
    console.error('DEEPSEEK_API_KEY is not configured.')
    process.exitCode = 1
    return
  }

  const snapshot = snapshotSchema.parse(JSON.parse(readFileSync(snapshotPath, 'utf8')))

  if (productionMode) {
    // Exactly what production sends and scores, against snapshot text.
    const submission = snapshot.submissions.find((s) => s.label === label)
    if (!submission) {
      console.error(`No submission labeled "${label}".`)
      process.exitCode = 1
      return
    }
    // Production skips blank work before calling the provider (R10).
    const words = submission.text.replace(/\[Image attached\]/g, ' ').trim().split(/\s+/).filter(Boolean)
    if (words.length < BLANK_SUBMISSION_MAX_WORDS && !/\[Image attached\]|Attached Artifacts:/.test(submission.text)) {
      console.log(JSON.stringify({
        label,
        noWork: true,
        scores: { completion: 0, thinking: 0, workflow: 0 },
        feedback: 'No work was submitted for this assignment.',
      }, null, 2))
      return
    }
    const profile = PIKA_ASSIGNMENT_GRADING_PROFILE
    const prompt = profile.buildPrompt({
      assignmentTitle: snapshot.assignmentTitle,
      instructions: snapshot.instructions,
      submission: submission.text,
    })
    const response = await createDeepSeekChatProvider({ apiKey }).generate({
      model: process.env.DEEPSEEK_GRADING_MODEL?.trim() || DEFAULT_MODEL,
      systemPrompt: prompt.systemPrompt,
      userPrompt: prompt.userPrompt,
      schemaName: profile.output.schemaName,
      jsonSchema: profile.output.jsonSchema,
      initialMaxOutputTokens: profile.output.initialMaxOutputTokens,
      fallbackMaxOutputTokens: profile.output.fallbackMaxOutputTokens,
      reasoningEffort: 'medium',
    })
    const output = profile.parseOutput(response.outputText)
    const workflow = scoreWorkflow({
      presentation: output.score_workflow,
      process: submission.process ?? null,
    })
    console.log(JSON.stringify({
      label,
      scores: {
        completion: output.score_completion,
        thinking: output.score_thinking,
        workflow: workflow.total,
      },
      workflow,
      feedback: [output.feedback, ...buildProcessReminders(submission.process ?? null)].join('\n'),
      tokenUsage: response.tokenUsage,
    }, null, 2))
    return
  }


  const submission = snapshot.submissions.find((s) => s.label === label)
  if (!submission) {
    console.error(`No submission labeled "${label}" in ${snapshotPath}.`)
    console.error(`Labels: ${snapshot.submissions.map((s) => s.label).join(', ')}`)
    process.exitCode = 1
    return
  }

  const calibrationPath = calibrationPathArg
    ?? snapshotPath.replace(/\.grading-snapshot\.json$/, '.grader-calibration.json')
  // General rules live in a shared file next to the per-assignment one.
  const sharedPath = join(dirname(calibrationPath), 'shared.grader-calibration.json')
  const readCalibration = (path: string) => (existsSync(path)
    ? calibrationFileSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
    : null)
  const shared = readCalibration(sharedPath)
  const assignment = readCalibration(calibrationPath)
  const approved: CalibrationRule[] = [...(shared?.rules ?? []), ...(assignment?.rules ?? [])]
    .filter((rule) => rule.status === 'approved')
  const expectsMultipleSessions = assignment?.assignmentSettings?.expectsMultipleSessions ?? false
  const promptRules = approved
    .map((rule) => (rule.promptText === undefined ? rule.text : rule.promptText))
    .filter((text): text is string => typeof text === 'string' && text.length > 0)
  const splitWorkflow = approved.some((rule) => rule.id === 'R2')

  const hasRule = (id: string) => approved.some((rule) => rule.id === id)
  const input = {
    assignmentTitle: snapshot.assignmentTitle,
    instructions: snapshot.instructions,
    submission: submission.text,
  }

  // R10: no real work means no AI call.
  const words = submission.text.replace(/\[Image attached\]/g, ' ').trim().split(/\s+/).filter(Boolean)
  const hasAttachments = /\[Image attached\]|Attached Artifacts:/.test(submission.text)
  if (hasRule('R10') && words.length < 10 && !hasAttachments) {
    console.log(JSON.stringify({
      label: submission.label,
      submissionText: submission.text,
      process: submission.process ?? null,
      approvedRulesApplied: approved.map((rule) => rule.id),
      noWork: true,
      revised: {
        scores: { completion: 0, thinking: 0, workflow: 0 },
        normalized: {
          criteria: [],
          feedback: {
            student: 'No work was submitted for this assignment. Complete every task in the instructions directly in Pika and submit it.',
            teacherNotes: 'Skipped AI grading: fewer than 10 words and no attachments.',
          },
        },
        tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      },
    }, null, 2))
    return
  }

  // One call per version, like production. A failed call is retried, not averaged.
  const gradeOnce = async (rules: string[]) => {
    for (let attempt = 1; ; attempt++) {
      try {
        const run = await runCalibrationGrade(input, rules, apiKey)
        const scores = Object.fromEntries(
          run.normalized.criteria.map((criterion) => [criterion.criterionId, criterion.score]),
        ) as CriterionScores
        return { ...run, scores }
      } catch (error) {
        if (attempt >= 3) throw error
        console.error(`Attempt ${attempt} failed; retrying.`)
      }
    }
  }

  const baseline = withBaseline ? await gradeOnce([]) : null
  const revised = approved.length > 0 ? await gradeOnce(promptRules) : null

  let workflowBreakdown = null
  if (revised && splitWorkflow) {
    workflowBreakdown = scoreWorkflow({
      presentation: revised.scores.workflow,
      process: submission.process ?? null,
      expectsMultipleSessions,
    })
    revised.scores.workflow = workflowBreakdown.total
  }

  // R8: the grader never sees process data, so the reminder is added in code.
  const authenticity = submission.process?.authenticityScore
  if (revised && hasRule('R8') && authenticity != null && authenticity < 70) {
    revised.normalized.feedback.student +=
      '\nReminder: type all of your work directly in Pika. Do not paste it in from somewhere else.'
  }
  if (revised && hasRule('R10') && submission.process && !submission.process.submitted) {
    revised.normalized.feedback.student +=
      '\nReminder: this work was never submitted. Make sure you press Submit on future assignments.'
  }

  console.log(JSON.stringify({
    label: submission.label,
    submissionText: submission.text,
    existingGrade: submission.existingGrade ?? null,
    process: submission.process ?? null,
    approvedRulesApplied: approved.map((rule) => rule.id),
    workflowBreakdown,
    baseline,
    revised,
  }, null, 2))
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Calibration grading failed')
  process.exitCode = 1
})
