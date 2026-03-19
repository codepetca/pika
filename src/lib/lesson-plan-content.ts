import { limitedMarkdownToPlainText, markdownToTiptapContent, tiptapToMarkdown } from '@/lib/limited-markdown'
import type { LessonPlan, TiptapContent } from '@/types'

type LessonPlanContentSource = Pick<LessonPlan, 'content_markdown'> & {
  content?: TiptapContent | null
}

export type LessonPlanMarkdownResult = {
  markdown: string
  warnings: string[]
  hasLossyConversion: boolean
  source: 'markdown' | 'content' | 'empty'
}

export function normalizeLessonPlanMarkdown(markdown: string | null | undefined): string {
  return String(markdown ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

export function getLessonPlanMarkdown(plan: LessonPlanContentSource | null | undefined): LessonPlanMarkdownResult {
  const markdown = normalizeLessonPlanMarkdown(plan?.content_markdown)
  if (markdown.trim().length > 0) {
    return {
      markdown,
      warnings: [],
      hasLossyConversion: false,
      source: 'markdown',
    }
  }

  if (plan?.content) {
    const converted = tiptapToMarkdown(plan.content)
    return {
      markdown: converted.markdown,
      warnings: converted.warnings,
      hasLossyConversion: converted.hasLossyConversion,
      source: converted.markdown.trim().length > 0 ? 'content' : 'empty',
    }
  }

  return {
    markdown: '',
    warnings: [],
    hasLossyConversion: false,
    source: 'empty',
  }
}

export function buildLessonPlanContentFields(markdown: string): {
  content_markdown: string
  content: TiptapContent
  plain_text: string
} {
  const normalized = normalizeLessonPlanMarkdown(markdown)
  return {
    content_markdown: normalized,
    content: markdownToTiptapContent(normalized),
    plain_text: limitedMarkdownToPlainText(normalized),
  }
}
