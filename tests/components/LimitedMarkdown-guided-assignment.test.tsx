import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LimitedMarkdown } from '@/components/LimitedMarkdown'
import { normalizeGeneratedAssignmentInstructions } from '@/lib/server/guided-assignment-markdown'

describe('guided assignment instruction rendering', () => {
  it('renders supported reference headings and both valid fence lengths without losing following prose', () => {
    const content = normalizeGeneratedAssignmentInstructions([
      '## Task',
      'Write a Karel method.',
      '---',
      '## Coding reference',
      '### Instructions',
      '````java',
      '## code heading',
      '```',
      '---',
      '````',
      'After the backtick example.',
      '~~~java',
      '## tilde example',
      '---',
      '~~~',
      'After the tilde example.',
    ].join('\n'))
    const { container } = render(<LimitedMarkdown content={content} />)
    expect(screen.getByRole('heading', { level: 3, name: 'Task' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Coding reference' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Instructions' })).toBeInTheDocument()
    const codeBlocks = [...container.querySelectorAll('pre code')]
    expect(codeBlocks).toHaveLength(2)
    expect(codeBlocks[0].textContent).toBe('## code heading\n```\n---')
    expect(codeBlocks[1].textContent).toBe('## tilde example\n---')
    expect(screen.getByText('After the backtick example.')).toBeInTheDocument()
    expect(screen.getByText('After the tilde example.')).toBeInTheDocument()
    expect(container).not.toHaveTextContent('#### Instructions')
    expect(container).not.toHaveTextContent('***')
  })
})
