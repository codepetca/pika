import { format, parse, isWeekend } from 'date-fns'
import type { Classroom, LessonPlan, TiptapContent } from '@/types'

const EMPTY_CONTENT: TiptapContent = { type: 'doc', content: [] }

/**
 * Convert lesson plans to markdown format for export
 */
export function lessonPlansToMarkdown(
  classroom: Classroom,
  plans: LessonPlan[],
  startDate: string,
  endDate: string
): string {
  const lines: string[] = [
    `# Lesson Plans: ${classroom.title}`,
    `Term: ${startDate} - ${endDate}`,
    '',
  ]

  // Create a map for quick lookup
  const planMap = new Map<string, LessonPlan>()
  plans.forEach((p) => planMap.set(p.date, p))

  // Generate entries for all weekdays in range
  const start = new Date(startDate)
  const end = new Date(endDate)
  const current = new Date(start)

  while (current <= end) {
    // Skip weekends
    if (!isWeekend(current)) {
      const dateStr = format(current, 'yyyy-MM-dd')
      const dayLabel = format(current, 'EEE, MMM d, yyyy')
      lines.push(`## ${dayLabel}`)

      const plan = planMap.get(dateStr)
      if (plan && plan.content.content && plan.content.content.length > 0) {
        const text = extractTextFromTiptap(plan.content)
        lines.push(text || '(empty)')
      } else {
        lines.push('(empty)')
      }
      lines.push('')
    }
    current.setDate(current.getDate() + 1)
  }

  return lines.join('\n')
}

/**
 * Parse markdown back to lesson plans
 */
export function markdownToLessonPlans(
  markdown: string,
  classroom: Classroom
): { plans: Array<{ date: string; content: TiptapContent }>; errors: string[] } {
  const errors: string[] = []
  const plans: Array<{ date: string; content: TiptapContent }> = []
  const seenDates = new Set<string>()

  const lines = markdown.split('\n')
  let currentDate: string | null = null
  let currentContent: string[] = []

  const datePattern = /^## \w+, (\w+ \d+, \d{4})$/

  function flushCurrentPlan() {
    if (currentDate) {
      const text = currentContent.join('\n').trim()
      if (text && text !== '(empty)') {
        plans.push({
          date: currentDate,
          content: textToTiptapContent(text),
        })
      }
    }
    currentContent = []
  }

  for (const line of lines) {
    // Check for date header
    const match = line.match(datePattern)
    if (match) {
      // Flush previous
      flushCurrentPlan()

      // Parse the date
      try {
        const parsed = parse(match[1], 'MMM d, yyyy', new Date())
        if (isNaN(parsed.getTime())) {
          errors.push(`Invalid date: ${match[1]}`)
          currentDate = null
          continue
        }

        const dateStr = format(parsed, 'yyyy-MM-dd')

        // Check for duplicate
        if (seenDates.has(dateStr)) {
          errors.push(`Duplicate date: ${dateStr}`)
          currentDate = null
          continue
        }

        // Check for weekend
        if (isWeekend(parsed)) {
          errors.push(`Weekend date not allowed: ${dateStr}`)
          currentDate = null
          continue
        }

        // Validate within term range if available
        if (classroom.start_date && dateStr < classroom.start_date) {
          errors.push(`Date ${dateStr} is before term start`)
          currentDate = null
          continue
        }
        if (classroom.end_date && dateStr > classroom.end_date) {
          errors.push(`Date ${dateStr} is after term end`)
          currentDate = null
          continue
        }

        seenDates.add(dateStr)
        currentDate = dateStr
      } catch (err) {
        errors.push(`Failed to parse date: ${match[1]}`)
        currentDate = null
      }
    } else if (currentDate !== null) {
      // Skip the title line and term line
      if (!line.startsWith('# ') && !line.startsWith('Term:')) {
        currentContent.push(line)
      }
    }
  }

  // Flush last plan
  flushCurrentPlan()

  return { plans, errors }
}

/**
 * Extract plain text from Tiptap content
 */
export function extractTextFromTiptap(content: TiptapContent): string {
  const lines: string[] = []

  function processNode(node: any): void {
    if (node.type === 'text') {
      lines.push(node.text || '')
    } else if (node.content) {
      node.content.forEach(processNode)
      if (node.type === 'paragraph' || node.type === 'heading') {
        lines.push('\n')
      }
    }
  }

  if (content.content) {
    content.content.forEach(processNode)
  }

  return lines.join('').trim()
}

/**
 * Convert plain text to Tiptap content
 */
export function textToTiptapContent(text: string): TiptapContent {
  if (!text.trim()) {
    return EMPTY_CONTENT
  }

  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim())

  return {
    type: 'doc',
    content: paragraphs.map((p) => ({
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: p.trim(),
        },
      ],
    })),
  }
}
