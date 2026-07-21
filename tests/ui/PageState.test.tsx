import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PageState } from '@/ui'

describe('PageState', () => {
  it('announces loading without exposing decorative icon content', () => {
    render(<PageState kind="loading" title="Loading classroom" />)

    const state = screen.getByRole('status', { name: '' })
    expect(state).toHaveAttribute('aria-live', 'polite')
    expect(state).toHaveAttribute('aria-busy', 'true')
    expect(state).toHaveAttribute('data-page-state', 'loading')
    expect(screen.getByRole('heading', { level: 2, name: 'Loading classroom' })).toBeInTheDocument()
  })

  it.each([
    ['error', 'Could not load classrooms'],
    ['forbidden', 'Classroom unavailable'],
  ] as const)('uses assertive semantics for the %s state', (kind, title) => {
    render(<PageState kind={kind} title={title} description="Try another route." />)

    const state = screen.getByRole('alert')
    expect(state).toHaveAttribute('aria-live', 'assertive')
    expect(state).not.toHaveAttribute('aria-busy')
    expect(state).toHaveTextContent('Try another route.')
  })

  it('renders an empty state action and supports compact section use', () => {
    render(
      <PageState
        kind="empty"
        title="No classrooms yet"
        action={<button type="button">Create classroom</button>}
        compact
      />,
    )

    const state = screen.getByRole('status')
    expect(state).toHaveClass('min-h-40', 'py-8')
    expect(screen.getByRole('button', { name: 'Create classroom' })).toBeInTheDocument()
  })

  it('supports a page-level heading when the state owns the route', () => {
    render(<PageState kind="error" title="Page failed" headingLevel="h1" />)

    expect(screen.getByRole('heading', { level: 1, name: 'Page failed' })).toBeInTheDocument()
  })
})
