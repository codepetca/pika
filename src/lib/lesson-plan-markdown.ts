import { format, isWeekend, parse } from 'date-fns'
import { getLessonPlanMarkdown, normalizeLessonPlanMarkdown, buildLessonPlanContentFields } from '@/lib/lesson-plan-content'
import { limitedMarkdownToPlainText, markdownToTiptapContent, tiptapToMarkdown } from '@/lib/limited-markdown'
import type { Classroom, LessonPlan, TiptapContent } from '@/types'

/**
 * Convert lesson plans to markdown format for export
 */
export function lessonPlansToMarkdown(
  _classroom: Classroom,
  plans: LessonPlan[],
  startDate: string,
  endDate: string
): string {
  const lines: string[] = []

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
      lines.push(`## ${dateStr}`)

      const plan = planMap.get(dateStr)
      const markdown = getLessonPlanMarkdown(plan).markdown
      if (markdown.trim().length > 0) {
        lines.push(markdown.trim())
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
): {
  plans: Array<{ date: string; content_markdown: string; content: TiptapContent }>
  clearedDates: string[]
  errors: string[]
} {
  const errors: string[] = []
  const plans: Array<{ date: string; content_markdown: string; content: TiptapContent }> = []
  const clearedDates: string[] = []
  const seenDates = new Set<string>()

  const lines = markdown.split('\n').map(line => line.replace(/\r$/, ''))
  let currentDate: string | null = null
  let currentContent: string[] = []

  const datePattern = /^## (\d{4}-\d{2}-\d{2})$/

  function flushCurrentPlan() {
    if (currentDate) {
      const normalized = normalizeLessonPlanMarkdown(currentContent.join('\n')).trim()
      if (normalized) {
        const contentFields = buildLessonPlanContentFields(normalized)
        plans.push({
          date: currentDate,
          content_markdown: contentFields.content_markdown,
          content: contentFields.content,
        })
      } else {
        clearedDates.push(currentDate)
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
        const dateStr = match[1]
        const parsed = parse(dateStr, 'yyyy-MM-dd', new Date())
        if (isNaN(parsed.getTime())) {
          errors.push(`Invalid date: ${dateStr}`)
          currentDate = null
          continue
        }

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

  return { plans, clearedDates, errors }
}

export function extractTextFromTiptap(content: TiptapContent): string {
  return limitedMarkdownToPlainText(tiptapToMarkdown(content).markdown)
}

export function textToTiptapContent(text: string): TiptapContent {
  return markdownToTiptapContent(text.trim())
}
