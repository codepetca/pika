export interface CourseBlueprintAssignmentMarkdownRecord {
  id?: string
  title: string
  instructions_markdown: string
  default_due_days: number
  default_due_time: string
  points_possible: number | null
  include_in_final: boolean
  is_draft: boolean
  position: number
}

export interface CourseBlueprintAssignmentsParseResult {
  assignments: CourseBlueprintAssignmentMarkdownRecord[]
  errors: string[]
  warnings: string[]
}

export function courseBlueprintAssignmentsToMarkdown(
  assignments: CourseBlueprintAssignmentMarkdownRecord[]
): string {
  const lines: string[] = []

  assignments.forEach((assignment) => {
    lines.push(`## ${assignment.title}${assignment.is_draft ? ' [DRAFT]' : ''}`)
    lines.push(`Due Days: ${assignment.default_due_days}`)
    lines.push(`Due Time: ${assignment.default_due_time}`)
    if (assignment.points_possible !== null && assignment.points_possible !== undefined) {
      lines.push(`Points: ${assignment.points_possible}`)
    }
    lines.push(`Include In Final: ${assignment.include_in_final ? 'true' : 'false'}`)
    lines.push('')
    if (assignment.instructions_markdown.trim()) {
      lines.push(assignment.instructions_markdown.trim())
      lines.push('')
    }
    lines.push('---')
    lines.push('')
  })

  return lines.join('\n').trim()
}

function normalizeLineEndings(markdown: string): string[] {
  return markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
}

export function markdownToCourseBlueprintAssignments(
  markdown: string,
  existingAssignments: CourseBlueprintAssignmentMarkdownRecord[]
): CourseBlueprintAssignmentsParseResult {
  const errors: string[] = []
  const warnings: string[] = []
  const assignments: CourseBlueprintAssignmentMarkdownRecord[] = []
  const existingByTitle = new Map(existingAssignments.map((assignment) => [assignment.title.toLowerCase(), assignment]))
  const seenTitles = new Set<string>()
  const lines = normalizeLineEndings(markdown)

  let current: Partial<CourseBlueprintAssignmentMarkdownRecord> | null = null
  let instructionLines: string[] = []
  let lineNumber = 0
  let startLine = 0

  function flushAssignment() {
    if (!current) return

    const title = current.title?.trim()
    if (!title) {
      errors.push(`Assignment at line ${startLine} has no title`)
      current = null
      instructionLines = []
      return
    }

    const titleKey = title.toLowerCase()
    if (seenTitles.has(titleKey)) {
      errors.push(`Duplicate assignment title: "${title}"`)
      current = null
      instructionLines = []
      return
    }

    const defaultDueDays = Number.isInteger(current.default_due_days)
      ? Number(current.default_due_days)
      : NaN
    if (!Number.isFinite(defaultDueDays) || defaultDueDays < 0) {
      errors.push(`Assignment "${title}" has invalid Due Days`)
      current = null
      instructionLines = []
      return
    }

    const defaultDueTime = String(current.default_due_time ?? '').trim()
    if (!/^\d{2}:\d{2}$/.test(defaultDueTime)) {
      errors.push(`Assignment "${title}" has invalid Due Time`)
      current = null
      instructionLines = []
      return
    }

    const existing = existingByTitle.get(titleKey)
    seenTitles.add(titleKey)

    assignments.push({
      id: existing?.id,
      title,
      instructions_markdown: instructionLines.join('\n').trim(),
      default_due_days: defaultDueDays,
      default_due_time: defaultDueTime,
      points_possible:
        typeof current.points_possible === 'number' && Number.isFinite(current.points_possible)
          ? current.points_possible
          : null,
      include_in_final: current.include_in_final !== false,
      is_draft: current.is_draft !== false,
      position: assignments.length,
    })

    current = null
    instructionLines = []
  }

  for (const line of lines) {
    lineNumber += 1

    const titleMatch = line.match(/^##\s*(.*?)(?:\s+\[DRAFT\])?$/)
    if (titleMatch) {
      flushAssignment()
      startLine = lineNumber
      current = {
        title: titleMatch[1].trim(),
        is_draft: line.includes('[DRAFT]'),
        include_in_final: true,
        default_due_days: 0,
        default_due_time: '23:59',
      }
      continue
    }

    if (!current) continue

    if (line.trim() === '---') {
      flushAssignment()
      continue
    }

    const fieldMatch = line.match(/^([A-Za-z ]+):\s*(.+)$/)
    if (fieldMatch) {
      const key = fieldMatch[1].trim().toLowerCase()
      const value = fieldMatch[2].trim()
      if (key === 'due days') {
        current.default_due_days = Number(value)
        continue
      }
      if (key === 'due time') {
        current.default_due_time = value
        continue
      }
      if (key === 'points') {
        current.points_possible = Number(value)
        continue
      }
      if (key === 'include in final') {
        current.include_in_final = ['true', 'yes', '1'].includes(value.toLowerCase())
        continue
      }
    }

    if (instructionLines.length > 0 || line.trim()) {
      instructionLines.push(line)
    }
  }

  flushAssignment()

  existingAssignments.forEach((assignment) => {
    if (!seenTitles.has(assignment.title.toLowerCase())) {
      warnings.push(`Assignment "${assignment.title}" not in markdown - will be preserved`)
    }
  })

  return { assignments, errors, warnings }
}
