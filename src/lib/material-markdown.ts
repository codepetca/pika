import { markdownToTiptapContent, tiptapToMarkdown, type TiptapMarkdownResult } from '@/lib/limited-markdown'
import type { TiptapContent, TiptapNode } from '@/types'

/** Source lives beside the compatibility document so ordinary material saves retain it. */
export function getMaterialMarkdownSource(content: TiptapContent): string | null {
  const value = content.attrs?.authoring_markdown
  return typeof value === 'string' ? value : null
}

export function getMaterialMarkdownDraft(content: TiptapContent): TiptapMarkdownResult {
  const source = getMaterialMarkdownSource(content)
  return source === null ? tiptapToMarkdown(content) : { markdown: source, warnings: [], hasLossyConversion: false }
}

export function createMaterialMarkdownContent(markdown: string): TiptapContent {
  return { ...markdownToTiptapContent(markdown), attrs: { authoring_markdown: markdown } }
}

/** Display legacy block images in the editor's stable inline-image schema without changing saved JSON. */
export function getMaterialVisualContent(content: TiptapContent): TiptapContent {
  function normalize(nodes: TiptapNode[], inlineParent: boolean): TiptapNode[] {
    return nodes.map(node => {
      if (node.type === 'image' && !inlineParent) return { type: 'paragraph', content: [node] }
      return node.content
        ? { ...node, content: normalize(node.content, node.type === 'paragraph' || node.type === 'heading') }
        : node
    })
  }
  const source = getMaterialMarkdownSource(content)
  const document = source === null ? content : createMaterialMarkdownContent(source)
  return { ...document, content: normalize(document.content ?? [], false) }
}
