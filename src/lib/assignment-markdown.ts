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

    // Due date in Toronto timezone
    const dueDate = toZonedTime(new Date(assignment.due_at), TORONTO_TZ)
    const formattedDate = format(dueDate, "EEE, MMM d, yyyy 'at' h:mm a")
    lines.push(`Due: ${formattedDate}`)

    // ID for existing assignments
    lines.push(`ID: ${assignment.id}`)
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

  // Build lookup map for existing assignments
  const existingById = new Map<string, Assignment>()
  for (const a of existingAssignments) {
    existingById.set(a.id, a)
  }

  const lines = markdown.split('\n')
  let currentAssignment: Partial<ParsedAssignment> | null = null
  let currentInstructionLines: string[] = []
  let lineNumber = 0
  let assignmentStartLine = 0
  const seenIds = new Set<string>()

  function flushAssignment() {
    if (!currentAssignment) return

    // Validate required fields
    if (!currentAssignment.title?.trim()) {
      errors.push(`Assignment at line ${assignmentStartLine} has no title`)
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

    // If there's an ID, validate it exists
    if (currentAssignment.id) {
      const existing = existingById.get(currentAssignment.id)
      if (!existing) {
        errors.push(`Assignment ID not found: ${currentAssignment.id}`)
        currentAssignment = null
        currentInstructionLines = []
        return
      }

      // Check for un-release attempt
      if (!existing.is_draft && currentAssignment.is_draft) {
        errors.push(`Cannot un-release assignment: ${currentAssignment.title}`)
        currentAssignment = null
        currentInstructionLines = []
        return
      }

      seenIds.add(currentAssignment.id)
    }

    // Set instructions from accumulated lines
    currentAssignment.instructions = currentInstructionLines.join('\n').trim()

    // Set position based on order
    currentAssignment.position = assignments.length

    // New assignments (no ID) are always drafts
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

    // Check for ID line
    const idMatch = line.match(/^ID:\s*(.+)$/)
    if (idMatch) {
      currentAssignment.id = idMatch[1].trim()
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
    if (!seenIds.has(existing.id)) {
      warnings.push(`Assignment "${existing.title}" (${existing.id}) not in markdown - will be preserved`)
    }
  }

  return { assignments, errors, warnings }
}

/**
 * Parse due date string back to ISO format
 * Expects format: "EEE, MMM d, yyyy 'at' h:mm a" (e.g., "Mon, Jan 20, 2025 at 11:59 PM")
 */
function parseDueDate(dateStr: string): string | null {
  try {
    // Try parsing the expected format
    const parsed = parse(dateStr, "EEE, MMM d, yyyy 'at' h:mm a", new Date())

    if (!isValid(parsed)) {
      return null
    }

    // Convert from Toronto time to UTC
    const utcDate = fromZonedTime(parsed, TORONTO_TZ)
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
