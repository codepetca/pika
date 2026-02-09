import type { LogSummaryItem } from '@/types'

const DEFAULT_MODEL = 'gpt-5-nano'

/**
 * Build a map of unique initials for each student.
 * Handles collisions by appending an index: "J.S.1", "J.S.2".
 */
export function buildInitialsMap(
  students: { firstName: string; lastName: string }[]
): Record<string, string> {
  const result: Record<string, string> = {}
  const counts: Record<string, number> = {}

  for (const student of students) {
    const fi = (student.firstName[0] || '?').toUpperCase()
    const li = (student.lastName[0] || '?').toUpperCase()
    const base = `${fi}.${li}.`
    const fullName = `${student.firstName} ${student.lastName}`

    counts[base] = (counts[base] || 0) + 1
    const key = counts[base] > 1 ? `${base}${counts[base]}` : base

    result[key] = fullName
  }

  // If any base had collisions, rename the first occurrence too
  for (const base of Object.keys(counts)) {
    if (counts[base] > 1 && result[base]) {
      const fullName = result[base]
      delete result[base]
      result[`${base}1`] = fullName
    }
  }

  return result
}

/**
 * Replace student names in text with their initials.
 * Replaces full names first, then individual first/last names.
 * Case-insensitive matching.
 */
export function sanitizeEntryText(
  text: string,
  students: { firstName: string; lastName: string }[],
  initialsMap: Record<string, string>
): string {
  // Build reverse map: fullName -> initials
  const nameToInitials: Record<string, string> = {}
  for (const [initials, fullName] of Object.entries(initialsMap)) {
    nameToInitials[fullName] = initials
  }

  let result = text

  // Replace full names first (longest match first to avoid partial replacements)
  const fullNames = students
    .map((s) => `${s.firstName} ${s.lastName}`)
    .filter((name) => name.trim().length > 1)
    .sort((a, b) => b.length - a.length)

  for (const fullName of fullNames) {
    const initials = nameToInitials[fullName]
    if (!initials) continue
    const escaped = escapeRegExp(fullName)
    result = result.replace(new RegExp(escaped, 'gi'), initials)
  }

  // Replace individual first names and last names
  for (const student of students) {
    const fullName = `${student.firstName} ${student.lastName}`
    const initials = nameToInitials[fullName]
    if (!initials) continue

    for (const name of [student.firstName, student.lastName]) {
      if (!name || name.length < 2) continue
      const escaped = escapeRegExp(name)
      // Use word boundary to avoid replacing substrings inside other words
      result = result.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), initials)
    }
  }

  return result
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Build the system and user prompts for the OpenAI summary call.
 */
export function buildSummaryPrompt(
  date: string,
  sanitizedLogs: { initials: string; text: string }[]
): { system: string; user: string } {
  const system = `You are a teaching assistant summarizing student daily logs. Analyze the logs and produce a JSON array of summary items. Each item has:
- "text": a concise summary point (1-2 sentences)
- "type": one of "question", "suggestion", "concern", or "reflection"
- "initials": the student's initials this item relates to

Tags:
- "question": student asked a question or expressed confusion
- "suggestion": student suggested something or had a creative idea
- "concern": student expressed frustration, difficulty, or something the teacher should follow up on
- "reflection": notable insight, progress, or positive observation

Respond with ONLY valid JSON: an array of objects. No markdown, no code blocks, no extra text.`

  const logEntries = sanitizedLogs
    .map((log) => `[${log.initials}]: ${log.text}`)
    .join('\n\n')

  const user = `Date: ${date}

Student logs:
${logEntries}`

  return { system, user }
}

/**
 * Call the OpenAI API to generate a log summary.
 * Follows the same pattern as ai-grading.ts.
 */
export async function callOpenAIForSummary(
  systemPrompt: string,
  userPrompt: string
): Promise<{ text: string; type: string; initials: string }[]> {
  const apiKey = getOpenAIKey()
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured')
  }

  const model = process.env.OPENAI_SUMMARY_MODEL?.trim() || DEFAULT_MODEL

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

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new Error(
      `Failed to parse summary response as JSON: ${outputText.slice(0, 200)}`
    )
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Expected JSON array from OpenAI summary response')
  }

  return parsed.map((item: any) => ({
    text: String(item.text || ''),
    type: String(item.type || 'reflection'),
    initials: String(item.initials || ''),
  }))
}

/**
 * Replace initials back to full student names in the summary items.
 */
export function restoreNames(
  items: { text: string; type: string; initials: string }[],
  initialsMap: Record<string, string>
): LogSummaryItem[] {
  // Sort by initials length descending so "J.S.1" is replaced before "J.S."
  const sortedEntries = Object.entries(initialsMap).sort(
    ([a], [b]) => b.length - a.length
  )

  return items.map((item) => {
    let text = item.text
    // Replace all initials in the text with full names
    for (const [initials, fullName] of sortedEntries) {
      const escaped = escapeRegExp(initials)
      text = text.replace(new RegExp(escaped, 'g'), fullName)
    }

    const studentName = initialsMap[item.initials] || item.initials
    const validTypes = ['question', 'suggestion', 'concern', 'reflection'] as const
    const type = validTypes.includes(item.type as any)
      ? (item.type as LogSummaryItem['type'])
      : 'reflection'

    return { text, type, studentName }
  })
}

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

/**
 * Return the model name used for summaries.
 */
export function getSummaryModel(): string {
  return process.env.OPENAI_SUMMARY_MODEL?.trim() || DEFAULT_MODEL
}
