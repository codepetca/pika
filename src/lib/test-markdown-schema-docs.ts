import { TEST_MARKDOWN_AI_SCHEMA, TEST_MARKDOWN_TOP_LEVEL_STRUCTURE } from './test-markdown-schema'

export const TEST_MARKDOWN_TOP_LEVEL_MARKER = 'TEST_MARKDOWN_TOP_LEVEL_STRUCTURE'
export const TEST_MARKDOWN_TEMPLATE_MARKER = 'TEST_MARKDOWN_AI_SCHEMA'

function renderMarkdownFence(content: string): string {
  return `\`\`\`md\n${content}\n\`\`\``
}

function replaceGeneratedSection(markdown: string, marker: string, replacement: string): string {
  const startMarker = `<!-- GENERATED:${marker}:start -->`
  const endMarker = `<!-- GENERATED:${marker}:end -->`
  const startIndex = markdown.indexOf(startMarker)
  const endIndex = markdown.indexOf(endMarker)

  if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) {
    throw new Error(`Missing generated section markers for ${marker}`)
  }

  const before = markdown.slice(0, startIndex + startMarker.length)
  const after = markdown.slice(endIndex)
  return `${before}\n${replacement}\n${after}`
}

export function syncTeacherTestsMarkdownSchemaDoc(markdown: string): string {
  const withTopLevel = replaceGeneratedSection(
    markdown,
    TEST_MARKDOWN_TOP_LEVEL_MARKER,
    renderMarkdownFence(TEST_MARKDOWN_TOP_LEVEL_STRUCTURE)
  )

  return replaceGeneratedSection(
    withTopLevel,
    TEST_MARKDOWN_TEMPLATE_MARKER,
    renderMarkdownFence(TEST_MARKDOWN_AI_SCHEMA)
  )
}
