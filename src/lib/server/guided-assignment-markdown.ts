/** The Blueprint format reserves headings, dividers, and metadata at the start of lines. */
const RESERVED_FIELD = /^(?:Artifact ID|Classwork Position|Due Days|Due Time|Points|Gradebook Weight|Include In Final|Track Authenticity):\s*.+$/i

function mapFencedLines(markdown: string, mapLine: (line: string, insideFence: boolean) => string): string {
  let fence: { marker: string; length: number } | null = null
  return markdown.replace(/\r\n?/g, '\n').split('\n').map((line) => {
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
    if (fence) {
      const isClose = fenceMatch?.[1]?.[0] === fence.marker
        && fenceMatch[1].length >= fence.length && !fenceMatch[2].trim()
      if (isClose) fence = null
      return mapLine(line, !isClose)
    }
    if (fenceMatch) {
      fence = { marker: fenceMatch[1][0], length: fenceMatch[1].length }
      return line
    }
    return mapLine(line, false)
  }).join('\n')
}

/** Keep generated student prose parseable without changing its fenced examples. */
export function normalizeGeneratedAssignmentInstructions(markdown: string): string {
  return mapFencedLines(markdown, (line, insideFence) => {
    if (insideFence) return line
    if (/^##(?!#)/.test(line)) {
      return /^##\s+(?:Submission Requirements|Instructions)\s*$/i.test(line)
        ? `##${line}` : `#${line}`
    }
    if (/^###\s+(?:Submission Requirements|Instructions)\s*$/i.test(line)) return `#${line}`
    if (line.trim() === '---') return line.replace('---', '***')
    if (RESERVED_FIELD.test(line)) return `\\${line}`
    return line
  })
}

/** Protect code from the legacy assignment parser, then restore it byte for byte. */
export function protectGuidedAssignmentCode(markdown: string): {
  content: string
  restore: (instructions: string) => string
} {
  const replacements = new Map<string, string>()
  let index = 0
  const content = mapFencedLines(markdown, (line, insideFence) => {
    if (!insideFence) return line
    let token: string
    do {
      token = `PIKA_FENCED_CODE_LINE_${index++}_${crypto.randomUUID()}`
    } while (markdown.includes(token))
    replacements.set(token, line)
    return token
  })
  return {
    content,
    restore: (instructions) => instructions.split('\n').map((line) => replacements.get(line) ?? line).join('\n'),
  }
}
