import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QuestionMarkdown } from '@/components/QuestionMarkdown'

describe('QuestionMarkdown', () => {
  it('renders inline markdown formatting', () => {
    render(
      <QuestionMarkdown content="Use **bold**, *italic*, `code`, and [docs](https://example.com)." />
    )

    expect(screen.getByText('bold')).toHaveClass('font-semibold')
    expect(screen.getByText('italic')).toHaveClass('italic')
    expect(screen.getByText('code')).toHaveClass('font-mono')
    expect(screen.getByRole('link', { name: 'docs' })).toHaveAttribute('href', 'https://example.com/')
  })

  it('renders lists and code blocks', () => {
    render(
      <QuestionMarkdown
        content={`## Prompt\n- First item\n- Second item\n\n\`\`\`\nconst x = 42;\n\`\`\``}
      />
    )

    expect(screen.getByText('Prompt')).toBeInTheDocument()
    expect(screen.getByText('First item')).toBeInTheDocument()
    expect(screen.getByText('Second item')).toBeInTheDocument()
    expect(screen.getByText('const x = 42;')).toBeInTheDocument()
  })

  it('does not render unsafe links as anchors', () => {
    render(<QuestionMarkdown content="[click me](javascript:alert(1))" />)

    expect(screen.queryByRole('link', { name: 'click me' })).not.toBeInTheDocument()
    expect(screen.getByText(/click me/)).toBeInTheDocument()
  })

  it('shows placeholder when content is empty', () => {
    render(<QuestionMarkdown content="   " />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})
