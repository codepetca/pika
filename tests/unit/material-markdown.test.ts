import { describe, expect, it } from 'vitest'
import { createMaterialMarkdownContent, getMaterialMarkdownSource, getMaterialMarkdownDraft, getMaterialVisualContent } from '@/lib/material-markdown'
import { isValidTiptapContent } from '@/lib/tiptap-content'

describe('Material Markdown compatibility', () => {
  it('persists the exact source with reader-compatible nodes across JSON transport', () => {
    const markdown = '# Reading\n\n- First  \n- Second\n'
    const stored = JSON.parse(JSON.stringify(createMaterialMarkdownContent(markdown)))
    expect(getMaterialMarkdownSource(stored)).toBe(markdown)
    expect(stored.content[0]).toMatchObject({ type: 'heading', attrs: { level: 1 } })
    expect(isValidTiptapContent(stored)).toBe(true)
  })

  it('derives the Write view from exact source even if compatibility nodes are stale', () => {
    const source = '# AI edited source\n\n![Diagram](/api/storage/authoring-images?object_id=11111111-1111-4111-8111-111111111111)\n'
    const stale = { type: 'doc' as const, attrs: { authoring_markdown: source }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Old text' }] }] }
    expect(getMaterialVisualContent(stale)).toEqual(createMaterialMarkdownContent(source))
    expect(stale.content[0].content[0].text).toBe('Old text')
  })

  it('keeps empty source distinct from legacy documents and reads without mutation', () => {
    const legacy = { type: 'doc' as const, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Keep me' }] }] }
    const before = structuredClone(legacy)
    expect(getMaterialMarkdownSource(legacy)).toBeNull()
    expect(getMaterialMarkdownDraft(legacy).markdown).toBe('Keep me')
    expect(legacy).toEqual(before)
    expect(getMaterialMarkdownSource(createMaterialMarkdownContent(''))).toBe('')
  })

  it('adapts legacy block images only for display while retaining inline images and the stored document', () => {
    const image = { type: 'image', attrs: { src: '', managed_object_id: 'managed-image', alt: 'Diagram' } }
    const legacy = { type: 'doc' as const, content: [image,
      { type: 'blockquote', content: [image] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Beside ' }, image] },
    ] }
    const before = structuredClone(legacy)
    const visual = getMaterialVisualContent(legacy)
    expect(visual.content?.[0]).toEqual({ type: 'paragraph', content: [image] })
    expect(visual.content?.[1].content?.[0]).toEqual({ type: 'paragraph', content: [image] })
    expect(visual.content?.[2]).toEqual(legacy.content[2])
    expect(legacy).toEqual(before)
    expect(getMaterialMarkdownSource(legacy)).toBeNull()
  })

})
