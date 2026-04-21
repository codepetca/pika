import {
  extractAssignmentArtifacts,
  type AssignmentArtifact,
} from '@/lib/assignment-artifacts'
import { extractPlainText } from '@/lib/tiptap-content'
import type { TiptapContent } from '@/types'

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

function formatArtifactLabel(artifact: AssignmentArtifact): string {
  switch (artifact.type) {
    case 'image':
      return 'Image'
    case 'repo':
      return 'Repository'
    default:
      return 'Link'
  }
}

function buildStudentSubmissionText(studentWork: TiptapContent): string {
  const studentText = extractPlainText(studentWork).trim()
  const artifacts = extractAssignmentArtifacts(studentWork)
  const sections: string[] = []

  if (studentText) {
    sections.push(studentText)
  }

  if (artifacts.length > 0) {
    const artifactLines = artifacts.map((artifact) => {
      const repoSummary =
        artifact.type === 'repo' && artifact.repo_owner && artifact.repo_name
          ? ` (${artifact.repo_owner}/${artifact.repo_name})`
          : ''
      return `- ${formatArtifactLabel(artifact)}: ${artifact.url}${repoSummary}`
    })
    sections.push(`Attached Artifacts:\n${artifactLines.join('\n')}`)
  }

  if (sections.length === 0) {
    throw new Error('Student work is empty')
  }

  return sections.join('\n\n')
}

export interface GradeResult {
  score_completion: number
  score_thinking: number
  score_workflow: number
  feedback: string
  model: string
}

export async function gradeStudentWork(opts: {
  assignmentTitle: string
  instructions: string
  studentWork: TiptapContent
  previousFeedback?: string | null
}): Promise<GradeResult> {
  const apiKey = getOpenAIKey()
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured')
  }

  const model = process.env.OPENAI_GRADING_MODEL?.trim() || DEFAULT_MODEL
  const studentSubmission = buildStudentSubmissionText(opts.studentWork)

  const systemPrompt = `You are an assignment grader. Grade the student's work using this rubric:

- **Completion** (0–10): Did the student complete all parts of the assignment?
- **Thinking** (0–10): Does the work show depth of thought, analysis, or understanding?
- **Workflow** (0–10): Is the work organized, clear, and well-presented?
- Treat attached artifacts (links, repositories, images) as part of the student's submission. Do not say a required site or artifact is missing if it appears in the "Attached Artifacts" section.

Respond with ONLY valid JSON in this format:
{"score_completion":N,"score_thinking":N,"score_workflow":N,"feedback":"..."}

Feedback rules:
- feedback should be 1-3 sentences
- include one sentence starting with "Strength:"
- include one sentence starting with "Next Step:"
- if total score is less than 30, include one sentence starting with "Improve:" and give one concrete improvement to reach full marks.`

  const userContent = `Assignment: ${opts.assignmentTitle}
Instructions: ${opts.instructions}

Student Work:
${studentSubmission}`

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: systemPrompt }],
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: userContent }],
        },
      ],
    }),
  })

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '')
    throw new Error(`OpenAI request failed (${res.status}): ${bodyText}`)
  }

  const payload = await res.json()
  const outputText = extractResponseOutputText(payload)
  if (!outputText) {
    throw new Error('OpenAI response missing output text')
  }

  // Parse JSON from response (handle markdown code blocks)
  let jsonText = outputText
  const codeBlockMatch = outputText.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch) {
    jsonText = codeBlockMatch[1].trim()
  }

  let parsed: any
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new Error(`Failed to parse grading response as JSON: ${outputText.slice(0, 200)}`)
  }

  const sc = Number(parsed.score_completion)
  const st = Number(parsed.score_thinking)
  const sw = Number(parsed.score_workflow)

  if ([sc, st, sw].some((n) => !Number.isInteger(n) || n < 0 || n > 10)) {
    throw new Error('Scores must be integers 0–10')
  }

  let feedback = String(parsed.feedback || '').trim()
  if (!feedback) {
    throw new Error('Feedback is empty')
  }

  // On resubmission, append new feedback after divider
  if (opts.previousFeedback) {
    feedback = `${opts.previousFeedback}\n\n--- Resubmission ---\n\n${feedback}`
  }

  return {
    score_completion: sc,
    score_thinking: st,
    score_workflow: sw,
    feedback,
    model,
  }
}
