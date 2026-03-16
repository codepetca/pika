import { z } from 'zod'
import type { RepoReviewEvidenceItem, RepoReviewSemanticBreakdown } from '@/types'

const DEFAULT_MODEL = 'gpt-5-nano'

function getOpenAIKey(): string | null {
  const key = process.env.OPENAI_API_KEY
  if (!key) return null
  return key.trim() || null
}

function extractResponseOutputText(payload: any): string | null {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim()
  }

  const output = payload?.output
  if (!Array.isArray(output)) return null

  for (const item of output) {
    const content = item?.content
    if (!Array.isArray(content)) continue
    for (const c of content) {
      if (c?.type === 'output_text' && typeof c?.text === 'string' && c.text.trim()) {
        return c.text.trim()
      }
    }
  }

  return null
}

const feedbackSchema = z.object({
  score_completion: z.number().int().min(0).max(10),
  score_thinking: z.number().int().min(0).max(10),
  score_workflow: z.number().int().min(0).max(10),
  summary: z.string().min(1),
  strengths: z.array(z.string()).default([]),
  concerns: z.array(z.string()).default([]),
  feedback: z.string().min(1),
  confidence: z.number().min(0).max(1),
})

const classificationSchema = z.object({
  items: z.array(z.object({
    id: z.string(),
    category: z.enum(['feature', 'bugfix', 'test', 'refactor', 'docs', 'styling', 'config', 'generated']),
  })),
})

export interface RepoReviewFeedbackResult {
  score_completion: number
  score_thinking: number
  score_workflow: number
  summary: string
  strengths: string[]
  concerns: string[]
  feedback: string
  confidence: number
  model: string
}

export interface RepoReviewFeedbackInput {
  assignmentTitle: string
  repoName: string
  studentName: string
  githubLogin: string | null
  commitCount: number
  activeDays: number
  sessionCount: number
  burstRatio: number
  weightedContribution: number
  relativeContributionShare: number
  spreadScore: number
  iterationScore: number
  reviewActivityCount: number
  areas: string[]
  semanticBreakdown: Partial<RepoReviewSemanticBreakdown>
  evidence: RepoReviewEvidenceItem[]
  warnings: string[]
  confidence: number
}

function parseJsonResponse<T>(outputText: string, schema: z.ZodSchema<T>): T {
  let jsonText = outputText
  const codeBlockMatch = outputText.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch) {
    jsonText = codeBlockMatch[1].trim()
  }

  const parsed = JSON.parse(jsonText)
  return schema.parse(parsed)
}

function scoreFromUnit(value: number): number {
  return Math.max(0, Math.min(10, Math.round(value * 10)))
}

function formatStrengths(strengths: string[]): string {
  if (!strengths.length) return ''
  return `Strengths: ${strengths.join('; ')}`
}

function formatConcerns(concerns: string[]): string {
  if (!concerns.length) return ''
  return `Concerns: ${concerns.join('; ')}`
}

export function buildHeuristicRepoReviewFeedback(input: RepoReviewFeedbackInput): RepoReviewFeedbackResult {
  const completion = scoreFromUnit(
    input.relativeContributionShare * 0.55
      + Math.min(input.areas.length, 4) / 4 * 0.25
      + Math.min((input.semanticBreakdown.test || 0) + (input.semanticBreakdown.refactor || 0), input.weightedContribution) / Math.max(input.weightedContribution || 1, 1) * 0.2
  )
  const thinking = scoreFromUnit(
    Math.min(input.areas.length, 4) / 4 * 0.4
      + Math.min((input.semanticBreakdown.feature || 0) + (input.semanticBreakdown.refactor || 0), input.weightedContribution) / Math.max(input.weightedContribution || 1, 1) * 0.35
      + Math.min(input.reviewActivityCount, 4) / 4 * 0.25
  )
  const workflow = scoreFromUnit(
    input.spreadScore * 0.4
      + (1 - input.burstRatio) * 0.35
      + input.iterationScore * 0.25
  )

  const strengths: string[] = []
  const concerns: string[] = []

  if (input.commitCount > 0) {
    strengths.push(`${input.commitCount} commit${input.commitCount === 1 ? '' : 's'} mapped to this student`)
  }
  if (input.spreadScore >= 0.5) {
    strengths.push('work was spread across the assignment window')
  }
  if (input.reviewActivityCount > 0) {
    strengths.push(`${input.reviewActivityCount} PR/review activit${input.reviewActivityCount === 1 ? 'y' : 'ies'} contributed collaboration evidence`)
  }
  if (input.burstRatio >= 0.75) {
    concerns.push('most work landed near the deadline')
  }
  if (input.commitCount <= 1 && input.reviewActivityCount === 0) {
    concerns.push('very limited visible activity was available to assess')
  }
  if (input.warnings.length > 0) {
    concerns.push(input.warnings[0])
  }

  const summary = `${input.studentName} contributed ${Math.round(input.relativeContributionShare * 100)}% of mapped weighted work in ${input.repoName}.`
  const improvement = workflow <= 5
    ? 'Improve: Break work into more sessions across the assignment window so the process is easier to evaluate.'
    : ''
  const parts = [
    summary,
    formatStrengths(strengths),
    formatConcerns(concerns),
    `Next Step: ${workflow <= 5 ? 'show a steadier workflow over time' : 'keep pairing implementation with visible iteration and tests'}.`,
    improvement,
  ].filter(Boolean)

  return {
    score_completion: completion,
    score_thinking: thinking,
    score_workflow: workflow,
    summary,
    strengths,
    concerns,
    feedback: parts.join(' '),
    confidence: input.confidence,
    model: 'heuristic',
  }
}

export async function classifyAmbiguousRepoReviewChanges(items: Array<{ id: string; summary: string }>): Promise<Record<string, string>> {
  const apiKey = getOpenAIKey()
  if (!apiKey || items.length === 0) return {}

  const model = process.env.OPENAI_GRADING_MODEL?.trim() || DEFAULT_MODEL
  const systemPrompt = `You classify software change summaries into one category.

Allowed categories:
- feature
- bugfix
- test
- refactor
- docs
- styling
- config
- generated

Respond with JSON only:
{"items":[{"id":"...","category":"feature"}]}`

  const userPrompt = items
    .map((item) => `- ${item.id}: ${item.summary}`)
    .join('\n')

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: [
        { role: 'system', content: [{ type: 'input_text', text: systemPrompt }] },
        { role: 'user', content: [{ type: 'input_text', text: userPrompt }] },
      ],
    }),
  })

  if (!res.ok) {
    return {}
  }

  const payload = await res.json()
  const outputText = extractResponseOutputText(payload)
  if (!outputText) return {}

  const parsed = parseJsonResponse(outputText, classificationSchema)
  return Object.fromEntries(parsed.items.map((item) => [item.id, item.category]))
}

export async function gradeRepoReviewFeedback(input: RepoReviewFeedbackInput): Promise<RepoReviewFeedbackResult> {
  const apiKey = getOpenAIKey()
  if (!apiKey) {
    return buildHeuristicRepoReviewFeedback(input)
  }

  const model = process.env.OPENAI_GRADING_MODEL?.trim() || DEFAULT_MODEL
  const systemPrompt = `You are grading repository contribution evidence for a teacher.

Use these rubric definitions:
- Completion (0-10): meaningful implementation ownership, task coverage, tests/refinement
- Thinking (0-10): complexity, debugging/refactoring evidence, review/problem-solving quality
- Workflow (0-10): consistency over time, iteration, commit hygiene, responsiveness to feedback

Rules:
- Use only the supplied evidence.
- Do not infer hidden work.
- Low confidence or incomplete evidence should lower confidence and lead to cautious scoring.
- Distinguish contribution size from workflow quality.
- Feedback must be 3-5 sentences total.
- If workflow is weak, include one sentence starting with "Improve:" and give a concrete workflow improvement.

Respond with JSON only:
{"score_completion":0,"score_thinking":0,"score_workflow":0,"summary":"","strengths":[""],"concerns":[""],"feedback":"","confidence":0.0}`

  const userPrompt = JSON.stringify({
    assignment_title: input.assignmentTitle,
    repo_name: input.repoName,
    student_name: input.studentName,
    github_login: input.githubLogin,
    metrics: {
      commit_count: input.commitCount,
      active_days: input.activeDays,
      session_count: input.sessionCount,
      burst_ratio: input.burstRatio,
      weighted_contribution: input.weightedContribution,
      relative_contribution_share: input.relativeContributionShare,
      spread_score: input.spreadScore,
      iteration_score: input.iterationScore,
      review_activity_count: input.reviewActivityCount,
      areas: input.areas,
      semantic_breakdown: input.semanticBreakdown,
      confidence: input.confidence,
    },
    evidence: input.evidence,
    warnings: input.warnings,
  })

  try {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: [
          { role: 'system', content: [{ type: 'input_text', text: systemPrompt }] },
          { role: 'user', content: [{ type: 'input_text', text: userPrompt }] },
        ],
      }),
    })

    if (!res.ok) {
      return buildHeuristicRepoReviewFeedback(input)
    }

    const payload = await res.json()
    const outputText = extractResponseOutputText(payload)
    if (!outputText) {
      return buildHeuristicRepoReviewFeedback(input)
    }

    const parsed = parseJsonResponse(outputText, feedbackSchema)
    const formattedFeedback = [
      parsed.summary,
      formatStrengths(parsed.strengths),
      formatConcerns(parsed.concerns),
      parsed.feedback,
    ].filter(Boolean).join(' ')

    return {
      ...parsed,
      feedback: formattedFeedback,
      model,
    }
  } catch {
    return buildHeuristicRepoReviewFeedback(input)
  }
}
