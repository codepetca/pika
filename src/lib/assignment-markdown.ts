import { format, parse, isValid } from 'date-fns'
import { toZonedTime, fromZonedTime } from 'date-fns-tz'
import { extractPlainText, plainTextToTiptapContent } from '@/lib/tiptap-content'
import type { Assignment, TiptapContent, TiptapNode } from '@/types'

const TORONTO_TZ = 'America/Toronto'

/**
 * Parsed assignment from markdown
 */
export interface ParsedAssignment {
  id?: string // undefined for new assignments
  title: string
  due_at: string // ISO 8601
  instructions: string // Plain text
  is_draft: boolean
  position: number
}

/**
 * Result of parsing markdown to assignments
 */
export interface MarkdownParseResult {
  assignments: ParsedAssignment[]
  errors: string[]
  warnings: string[]
}

/**
 * Result of serializing assignments to markdown
 */
export interface MarkdownSerializeResult {
  markdown: string
  hasRichContent: boolean
}

/**
 * Convert assignments to markdown format for editing
 */
export function assignmentsToMarkdown(
  assignments: Assignment[]
): MarkdownSerializeResult {
  const lines: string[] = []
  let hasRichContent = false

  for (let i = 0; i < assignments.length; i++) {
    const assignment = assignments[i]

    // Check for rich formatting
    if (assignment.rich_instructions && hasRichFormatting(assignment.rich_instructions)) {
      hasRichContent = true
    }

    // Title with optional [DRAFT] marker
    const draftMarker = assignment.is_draft ? ' [DRAFT]' : ''
    lines.push(`## ${assignment.title}${draftMarker}`)

    // Due date in YYYY-MM-DD format (Toronto timezone)
    const dueDate = toZonedTime(new Date(assignment.due_at), TORONTO_TZ)
    const formattedDate = format(dueDate, 'yyyy-MM-dd')
    lines.push(`Due: ${formattedDate}`)
    lines.push('')

    // Instructions (extract plain text from rich content if available)
    const instructionsText = assignment.rich_instructions
      ? extractPlainText(assignment.rich_instructions)
      : assignment.description || ''

    if (instructionsText.trim()) {
      lines.push(instructionsText.trim())
    }

    lines.push('')
    lines.push('---')
    lines.push('')
  }

  return {
    markdown: lines.join('\n'),
    hasRichContent,
  }
}

/**
 * Parse markdown back to assignment data
 */
export function markdownToAssignments(
  markdown: string,
  existingAssignments: Assignment[]
): MarkdownParseResult {
  const errors: string[] = []
  const warnings: string[] = []
  const assignments: ParsedAssignment[] = []

  // Build lookup map for existing assignments by title
  const existingByTitle = new Map<string, Assignment>()
  for (const a of existingAssignments) {
    existingByTitle.set(a.title.toLowerCase(), a)
  }

  const lines = markdown.split('\n')
  let currentAssignment: Partial<ParsedAssignment> | null = null
  let currentInstructionLines: string[] = []
  let lineNumber = 0
  let assignmentStartLine = 0
  const seenTitles = new Set<string>()

  function flushAssignment() {
    if (!currentAssignment) return

    // Validate required fields
    if (!currentAssignment.title?.trim()) {
      errors.push(`Assignment at line ${assignmentStartLine} has no title`)
      currentAssignment = null
      currentInstructionLines = []
      return
    }

    const titleLower = currentAssignment.title.toLowerCase()

    // Check for duplicate titles in markdown
    if (seenTitles.has(titleLower)) {
      errors.push(`Duplicate assignment title: "${currentAssignment.title}"`)
      currentAssignment = null
      currentInstructionLines = []
      return
    }

    if (!currentAssignment.due_at) {
      errors.push(`Assignment "${currentAssignment.title}" has no due date`)
      currentAssignment = null
      currentInstructionLines = []
      return
    }

    // Match to existing assignment by title
    const existing = existingByTitle.get(titleLower)
    if (existing) {
      currentAssignment.id = existing.id

      // Check for un-release attempt
      if (!existing.is_draft && currentAssignment.is_draft) {
        errors.push(`Cannot un-release assignment: ${currentAssignment.title}`)
        currentAssignment = null
        currentInstructionLines = []
        return
      }
    }

    seenTitles.add(titleLower)

    // Set instructions from accumulated lines
    currentAssignment.instructions = currentInstructionLines.join('\n').trim()

    // Set position based on order
    currentAssignment.position = assignments.length

    // New assignments (no existing match) are always drafts
    if (!currentAssignment.id) {
      currentAssignment.is_draft = true
    }

    assignments.push(currentAssignment as ParsedAssignment)
    currentAssignment = null
    currentInstructionLines = []
  }

  for (const line of lines) {
    lineNumber++

    // Check for title header (## Title or ## Title [DRAFT])
    const titleMatch = line.match(/^##\s*(.*?)(?:\s+\[DRAFT\])?$/)
    if (titleMatch) {
      // Flush previous assignment
      flushAssignment()

      // Start new assignment
      assignmentStartLine = lineNumber
      const rawTitle = titleMatch[1].trim()
      const isDraft = line.includes('[DRAFT]')

      currentAssignment = {
        title: rawTitle,
        is_draft: isDraft,
      }
      continue
    }

    // If not in an assignment, skip
    if (!currentAssignment) continue

    // Check for due date line
    const dueMatch = line.match(/^Due:\s*(.+)$/)
    if (dueMatch) {
      const dateStr = dueMatch[1].trim()
      const parsedDate = parseDueDate(dateStr)

      if (!parsedDate) {
        errors.push(`Invalid due date: ${dateStr}`)
        currentAssignment.due_at = undefined
      } else {
        currentAssignment.due_at = parsedDate
      }
      continue
    }

    // Check for separator
    if (line.trim() === '---') {
      flushAssignment()
      continue
    }

    // Skip header line
    if (line.startsWith('# Assignments:')) continue

    // Accumulate instruction lines (skip empty lines at the start)
    if (currentInstructionLines.length > 0 || line.trim()) {
      currentInstructionLines.push(line)
    }
  }

  // Flush last assignment
  flushAssignment()

  // Check for existing assignments not in markdown (add warning)
  for (const existing of existingAssignments) {
    if (!seenTitles.has(existing.title.toLowerCase())) {
      warnings.push(`Assignment "${existing.title}" not in markdown - will be preserved`)
    }
  }

  return { assignments, errors, warnings }
}

/**
 * Parse due date string back to ISO format
 * Expects format: "yyyy-MM-dd" (e.g., "2025-01-20")
 * Returns end of day in Toronto timezone converted to UTC
 */
function parseDueDate(dateStr: string): string | null {
  try {
    // Try parsing YYYY-MM-DD format
    const parsed = parse(dateStr, 'yyyy-MM-dd', new Date())

    if (!isValid(parsed)) {
      return null
    }

    // Set to end of day (11:59 PM) in Toronto timezone, then convert to UTC
    const endOfDay = new Date(parsed)
    endOfDay.setHours(23, 59, 0, 0)
    const utcDate = fromZonedTime(endOfDay, TORONTO_TZ)
    return utcDate.toISOString()
  } catch {
    return null
  }
}

/**
 * Check if TipTap content has rich formatting that would be lost in plain text
 */
export function hasRichFormatting(content: TiptapContent | null): boolean {
  if (!content || !content.content) return false

  function checkNode(node: TiptapNode): boolean {
    // Check for marks (bold, italic, link, etc.)
    if (node.marks && node.marks.length > 0) {
      return true
    }

    // Check for special block types
    if (
      node.type === 'bulletList' ||
      node.type === 'orderedList' ||
      node.type === 'heading' ||
      node.type === 'codeBlock' ||
      node.type === 'blockquote'
    ) {
      return true
    }

    // Recurse into content
    if (node.content) {
      for (const child of node.content) {
        if (checkNode(child)) return true
      }
    }

    return false
  }

  for (const node of content.content) {
    if (checkNode(node)) return true
  }

  return false
}
