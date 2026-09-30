/** Match the legacy parser's field grammar and its eight structural keys exactly. */
const LEGACY_FIELD_PATTERN = /^([A-Za-z ]+):\s*(.+)$/
const RESERVED_FIELDS = new Set([
  'artifact id', 'classwork position', 'due days', 'due time', 'points',
  'gradebook weight', 'include in final', 'track authenticity',
])

function reservedField(line: string): { key: string; label: string } | null {
  const match = line.match(LEGACY_FIELD_PATTERN)
  if (!match) return null
  const key = match[1].trim().toLowerCase()
  return RESERVED_FIELDS.has(key) ? { key, label: match[1] } : null
}

function reservedSection(line: string): 'requirements' | 'instructions' | null {
  const trimmed = line.trim()
  if (/^###\s+Submission Requirements\s*$/i.test(trimmed)) return 'requirements'
  if (/^###\s+Instructions\s*$/i.test(trimmed)) return 'instructions'
  return null
}

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
      return mapLine(line, false)
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
        ? `### **${line.replace(/^##\s+/, '').trim()}**` : `#${line}`
    }
    if (reservedSection(line)) {
      return `### **${line.trim().replace(/^###\s+/, '').trim()}**`
    }
    if (line.trim() === '---') return ''
    const field = reservedField(line)
    if (field) {
      const leading = field.label.match(/^ */)?.[0] ?? ''
      return `${leading}**${field.label.trim()}:**${line.slice(field.label.length + 1)}`
    }
    return line
  })
}

/** Reject edits the legacy parser would silently consume as structure rather than instructions. */
export function findAmbiguousGuidedAssignmentEdit(markdown: string): string | null {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  let lastContentLine = lines.length - 1
  while (lastContentLine >= 0 && !lines[lastContentLine].trim()) lastContentLine -= 1
  let lineNumber = 0
  let seenTitle = false
  let inBody = false
  let inRequirements = false
  let hasRequirement = false
  const headerFields = new Set<string>()
  let error: string | null = null
  mapFencedLines(markdown, (line, insideFence) => {
    const index = lineNumber++
    if (error) return line
    if (!seenTitle) {
      if (!insideFence && /^##(?!#)/.test(line)) seenTitle = true
      else if (line.trim()) error = 'Text before the assignment title is not supported'
      return line
    }
    if (insideFence) return line
    const field = reservedField(line)
    const section = reservedSection(line)
    if (!inBody && !line.trim()) {
      inBody = true
      return line
    }
    if (!inBody && !field && line.trim() !== '---') {
      inBody = true
    }
    if (line.trim() === '---' && index !== lastContentLine) {
      error = 'An assignment divider appears before the end of the preview'
    } else if (section === 'requirements') {
      if (inRequirements && !hasRequirement) error = 'Submission Requirements must contain a valid requirement row'
      inRequirements = true
      hasRequirement = false
    } else if (section === 'instructions') {
      if (!inRequirements || !hasRequirement) {
        error = 'A reserved assignment section heading appears inside the instructions'
      }
      inRequirements = false
    } else if (inRequirements && line.trim() && line.trim() !== '---') {
      if (!/^-\s+.+/.test(line.trim())) {
        error = 'Submission Requirements contains non-requirement text'
      } else {
        hasRequirement = true
      }
    } else if (field) {
      if (inBody || headerFields.has(field.key)) {
        error = 'Assignment metadata appears inside the instructions or is repeated'
      }
      headerFields.add(field.key)
    }
    return line
  })
  if (!error && inRequirements && !hasRequirement) {
    error = 'Submission Requirements must contain a valid requirement row'
  }
  return error
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
