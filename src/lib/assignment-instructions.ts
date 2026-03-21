import { limitedMarkdownToPlainText, markdownToTiptapContent, tiptapToMarkdown } from '@/lib/limited-markdown'
import type { Assignment, TiptapContent } from '@/types'

type AssignmentInstructionSource = Pick<
  Assignment,
  'instructions_markdown' | 'rich_instructions' | 'description'
>

export type AssignmentInstructionsResult = {
  markdown: string
  warnings: string[]
  hasLossyConversion: boolean
  source: 'markdown' | 'rich' | 'description' | 'empty'
}

export function normalizeAssignmentMarkdown(markdown: string | null | undefined): string {
  return String(markdown ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

export function getAssignmentInstructionsMarkdown(
  assignment: AssignmentInstructionSource
): AssignmentInstructionsResult {
  const markdown = normalizeAssignmentMarkdown(assignment.instructions_markdown)
  if (markdown.trim().length > 0) {
    return {
      markdown,
      warnings: [],
      hasLossyConversion: false,
      source: 'markdown',
    }
  }

  if (assignment.rich_instructions) {
    const converted = tiptapToMarkdown(assignment.rich_instructions)
    return {
      markdown: converted.markdown,
      warnings: converted.warnings,
      hasLossyConversion: converted.hasLossyConversion,
      source: converted.markdown.trim().length > 0 ? 'rich' : 'empty',
    }
  }

  const description = String(assignment.description ?? '')
  if (description.trim().length > 0) {
    return {
      markdown: description,
      warnings: [],
      hasLossyConversion: false,
      source: 'description',
    }
  }

  return {
    markdown: '',
    warnings: [],
    hasLossyConversion: false,
    source: 'empty',
  }
}

export function buildAssignmentInstructionFields(markdown: string): {
  instructions_markdown: string
  description: string
  rich_instructions: TiptapContent
} {
  const normalized = normalizeAssignmentMarkdown(markdown)
  return {
    instructions_markdown: normalized,
    description: limitedMarkdownToPlainText(normalized),
    rich_instructions: markdownToTiptapContent(normalized),
  }
}
