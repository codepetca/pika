import { describe, expect, it } from 'vitest'
import { materialMarkdownToContent, materialToMarkdown } from '@/lib/material-markdown'

describe('Material Markdown boundary', () => {
  it('exports supported content without changing the original', () => {
    const original = materialMarkdownToContent('# Reading\n\n**Before class**\n\n- Bring notes\n- Read [guide](https://example.com)\n\n```\nprint("hello")\n```')
    const before = structuredClone(original)
    expect(materialToMarkdown(original).warnings).toEqual([])
    expect(original).toEqual(before)
    expect(materialMarkdownToContent(materialToMarkdown(original).markdown)).toEqual(original)
  })

  it('warns when images, heading levels, nested lists or literal syntax would be simplified', () => {
    for (const content of [
      { type: 'doc' as const, content: [{ type: 'image', attrs: { src: 'https://example.com/image.png' } }] },
      { type: 'doc' as const, content: [{ type: 'heading', attrs: { level: 4 }, content: [{ type: 'text', text: 'Heading' }] }] },
      { type: 'doc' as const, content: [{ type: 'paragraph', content: [{ type: 'text', text: '**Literal stars**' }] }] },
      { type: 'doc' as const, content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Parent' }] }, { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Child' }] }] }] }] }] }] },
    ]) expect(materialToMarkdown(content).warnings.length).toBeGreaterThan(0)
  })

  it('ignores empty editor metadata and handles empty documents', () => {
    expect(materialToMarkdown({ type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: null }, content: [{ type: 'text', text: 'Read' }] }] }).warnings).toEqual([])
    expect(materialMarkdownToContent('')).toEqual({ type: 'doc', content: [] })
    expect(materialToMarkdown({ content: [{ content: [{ text: 'Read', type: 'text' }], type: 'paragraph' }], type: 'doc' }).warnings).toEqual([])
  })

  it('never emits unsafe links from proposed Markdown', () => {
    const content = materialMarkdownToContent('[Open](javascript:alert)')
    expect(JSON.stringify(content)).not.toContain('javascript:')
    expect(JSON.stringify(content)).toContain('Open')
  })
})
