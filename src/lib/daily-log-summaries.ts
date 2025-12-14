import { createHash } from 'crypto'

const DEFAULT_MODEL = 'gpt-5-nano'

function getOpenAIKey(): string | null {
  const key = process.env.OPENAI_API_KEY
  if (!key) return null
  return key.trim() || null
}

export function hashDailyLogText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
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

export async function generateDailyLogSummary(text: string): Promise<{
  summary: string
  model: string
}> {
  const apiKey = getOpenAIKey()
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured')
  }

  const model = process.env.OPENAI_DAILY_LOG_SUMMARY_MODEL?.trim() || DEFAULT_MODEL

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
          content: [
            {
              type: 'text',
              text:
                'Write a single concise sentence (one line) summarizing the student’s daily journal entry for a teacher. ' +
                'Be neutral and factual. Do not include the student’s name/email. If the entry is empty or unclear, say "No clear details provided."',
            },
          ],
        },
        { role: 'user', content: [{ type: 'text', text }] },
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

  return { summary: outputText, model }
}

