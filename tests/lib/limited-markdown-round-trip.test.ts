import { describe, expect, it } from 'vitest'
import {
  markdownToTiptapContent,
  roundTripLimitedMarkdown,
  tiptapToMarkdown,
} from '@/lib/limited-markdown'
import type { TiptapContent } from '@/types'

describe('limited markdown WYSIWYG round trips', () => {
  it('preserves the supported markdown-safe feature set', () => {
    const markdown = [
      '# Course expectations',
      '',
      'Use **clear evidence**, *specific examples*, `inline code`, and [the reference](https://example.com).',
      '',
      '## Checklist',
      '',
      '- Read the prompt',
      '- Review your draft',
      '',
      '1. Plan',
      '2. Write',
      '',
      '```',
      'const ready = true',
      '```',
    ].join('\n')

    const result = roundTripLimitedMarkdown(markdown)

    expect(result.isStable).toBe(true)
    expect(result.hasLossyConversion).toBe(false)
    expect(result.warnings).toEqual([])
    expect(result.markdown).toContain('# Course expectations')
    expect(result.markdown).toContain('**clear evidence**')
    expect(result.markdown).toContain('*specific examples*')
    expect(result.markdown).toContain('`inline code`')
    expect(result.markdown).toContain('[the reference](https://example.com/)')
  })

  it('sanitizes unsafe links while keeping their visible labels', () => {
    const result = roundTripLimitedMarkdown('[Open this](javascript:evil)')

    expect(result.isStable).toBe(true)
    expect(result.markdown).toBe('Open this')
  })

  it('reports formatting that is not safe for markdown-backed fields', () => {
    const content: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Underlined',
              marks: [{ type: 'underline' }],
            },
          ],
        },
      ],
    }

    const converted = tiptapToMarkdown(content)

    expect(converted.markdown).toBe('Underlined')
    expect(converted.hasLossyConversion).toBe(true)
    expect(converted.warnings).toContain(
      'Some rich text formatting was simplified when converting to markdown.',
    )
  })

  it('produces the same document after canonical serialization', () => {
    const content = markdownToTiptapContent('### Heading\n\nParagraph\nwith a break')
    const converted = tiptapToMarkdown(content)

    expect(markdownToTiptapContent(converted.markdown)).toEqual(content)
  })

  it('does not mutate TipTap content while merging adjacent text nodes', () => {
    const content: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hello ' },
            { type: 'text', text: 'world' },
          ],
        },
      ],
    }
    const original = structuredClone(content)

    expect(tiptapToMarkdown(content).markdown).toBe('Hello world')
    expect(content).toEqual(original)
  })
})
