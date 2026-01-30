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
  const studentText = extractPlainText(opts.studentWork)

  if (!studentText.trim()) {
    throw new Error('Student work is empty')
  }

  const systemPrompt = `You are an assignment grader. Grade the student's work using this rubric:

- **Completion** (0–10): Did the student complete all parts of the assignment?
- **Thinking** (0–10): Does the work show depth of thought, analysis, or understanding?
- **Workflow** (0–10): Is the work organized, clear, and well-presented?

Respond with ONLY valid JSON in this format:
{"score_completion":N,"score_thinking":N,"score_workflow":N,"feedback":"..."}

The feedback should be 2–4 sentences: mention strengths, areas for improvement, and be encouraging.`

  const userContent = `Assignment: ${opts.assignmentTitle}
Instructions: ${opts.instructions}

Student Work:
${studentText}`

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
