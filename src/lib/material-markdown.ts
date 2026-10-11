import { markdownToTiptapContent, tiptapToMarkdown } from '@/lib/limited-markdown'
import type { TiptapContent } from '@/types'

// Ignore empty editor metadata, but retain meaningful formatting/attributes.
function comparableContent(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(comparableContent)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, comparableContent(child)])
      .filter(([, child]) => child != null
        && !(Array.isArray(child) && child.length === 0)
        && !(typeof child === 'object' && Object.keys(child as object).length === 0)))
  }
  return value
}

/** Export for editing without replacing the stored rich document. */
export function materialToMarkdown(content: TiptapContent) {
  const converted = tiptapToMarkdown(content)
  const proposed = markdownToTiptapContent(converted.markdown)
  const differs = JSON.stringify(comparableContent(content)) !== JSON.stringify(comparableContent(proposed))
  return {
    markdown: converted.markdown,
    warnings: converted.warnings.length ? converted.warnings : differs
      ? ['Some content or formatting cannot be preserved in Markdown.'] : [],
  }
}

/** Uses the same supported Markdown and safe-link boundary as assignment instructions. */
export const materialMarkdownToContent = markdownToTiptapContent
