import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { AssignmentArtifactsCell } from '@/components/AssignmentArtifactsCell'
import type { AssignmentArtifact } from '@/lib/assignment-artifacts'
import { TooltipProvider } from '@/ui'

function renderWithTooltipProvider(ui: ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>)
}

describe('AssignmentArtifactsCell', () => {
  it('renders dash when there are no artifacts', () => {
    renderWithTooltipProvider(<AssignmentArtifactsCell artifacts={[]} isCompact={false} />)
    expect(screen.getByText('-')).toBeInTheDocument()
  })

  it('renders one pill per artifact in non-compact mode', () => {
    const artifacts: AssignmentArtifact[] = [
      { type: 'link', url: 'https://example.com/a' },
      { type: 'link', url: 'https://example.com/b' },
      { type: 'link', url: 'https://example.com/c' },
      { type: 'image', url: 'https://cdn.example.com/submission-images/pic.png' },
      { type: 'link', url: 'https://example.com/d' },
    ]

    renderWithTooltipProvider(<AssignmentArtifactsCell artifacts={artifacts} isCompact={false} />)
    expect(screen.getAllByRole('button', { name: /preview/i })).toHaveLength(5)
  })

  it('renders compact summary in compact mode', () => {
    const artifacts: AssignmentArtifact[] = [
      { type: 'link', url: 'https://example.com/a' },
      { type: 'image', url: 'https://cdn.example.com/submission-images/pic.png' },
    ]

    renderWithTooltipProvider(<AssignmentArtifactsCell artifacts={artifacts} isCompact />)
    expect(screen.getByRole('button', { name: /view 2 work items/i })).toHaveTextContent('2 items')
  })

  it('opens a link preview modal when a pill is clicked', () => {
    const artifacts: AssignmentArtifact[] = [
      { type: 'link', url: 'https://example.com/docs' },
    ]

    renderWithTooltipProvider(<AssignmentArtifactsCell artifacts={artifacts} isCompact={false} />)
    fireEvent.click(screen.getByRole('button', { name: /preview link/i }))
    expect(screen.getByText('Link Preview')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open/i })).toHaveAttribute('href', 'https://example.com/docs')
  })
})
