const DEFAULT_MODEL = 'gpt-5-nano'

function getOpenAIKey(): string | null {
  const key = process.env.OPENAI_API_KEY
  if (!key) return null
  const trimmed = key.trim()
  return trimmed || null
}

function extractOutputText(payload: any): string | null {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim()
  }

  const output = payload?.output
  if (!Array.isArray(output)) return null

  for (const item of output) {
    const content = item?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (block?.type === 'output_text' && typeof block?.text === 'string' && block.text.trim()) {
        return block.text.trim()
      }
    }
  }

  return null
}

export interface TestOpenResponseSuggestion {
  score: number
  feedback: string
  model: string
}

export async function suggestTestOpenResponseGrade(input: {
  testTitle: string
  questionText: string
  responseText: string
  maxPoints: number
}): Promise<TestOpenResponseSuggestion> {
  const apiKey = getOpenAIKey()
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured')
  }

  const model = process.env.OPENAI_GRADING_MODEL?.trim() || DEFAULT_MODEL
  const maxPoints = Math.max(0, input.maxPoints)

  const systemPrompt = `You grade open-response test answers.
Return ONLY valid JSON with this shape:
{"score": number, "feedback": "string"}

Rules:
- score must be between 0 and ${maxPoints}
- use at most 2 decimal places
- feedback should be 2-4 sentences with one strength and one concrete improvement`

  const userPrompt = `Test: ${input.testTitle}
Question:
${input.questionText}

Student response:
${input.responseText}`

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
          content: [{ type: 'input_text', text: userPrompt }],
        },
      ],
    }),
  })

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '')
    throw new Error(`OpenAI request failed (${res.status}): ${bodyText}`)
  }

  const payload = await res.json()
  const outputText = extractOutputText(payload)
  if (!outputText) {
    throw new Error('OpenAI response missing output text')
  }

  let jsonText = outputText
  const codeBlockMatch = outputText.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch) {
    jsonText = codeBlockMatch[1].trim()
  }

  let parsed: any
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new Error('Failed to parse AI grade suggestion')
  }

  const rawScore = Number(parsed?.score)
  if (!Number.isFinite(rawScore)) {
    throw new Error('AI grade suggestion did not include a numeric score')
  }
  const clampedScore = Math.min(maxPoints, Math.max(0, rawScore))
  const score = Math.round(clampedScore * 100) / 100

  const feedback = String(parsed?.feedback || '').trim()
  if (!feedback) {
    throw new Error('AI grade suggestion did not include feedback')
  }

  return { score, feedback, model }
}

