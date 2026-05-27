import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
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

  it('renders one icon pill per artifact', () => {
    const artifacts: AssignmentArtifact[] = [
      { type: 'link', url: 'https://example.com/a' },
      { type: 'link', url: 'https://example.com/b' },
      { type: 'link', url: 'https://example.com/c' },
      { type: 'image', url: 'https://cdn.example.com/submission-images/pic.png' },
      { type: 'link', url: 'https://example.com/d' },
    ]

    renderWithTooltipProvider(<AssignmentArtifactsCell artifacts={artifacts} isCompact={false} />)
    const buttons = screen.getAllByRole('button', { name: /view work items; artifact/i })
    expect(buttons).toHaveLength(5)
    expect(buttons.map((button) => button.textContent)).toEqual(['1', '2', '3', '4', '5'])
    expect(screen.queryByText('example.com/a')).not.toBeInTheDocument()
  })

  it('uses the same icon pills in compact mode', () => {
    const artifacts: AssignmentArtifact[] = [
      { type: 'link', url: 'https://example.com/a' },
      { type: 'image', url: 'https://cdn.example.com/submission-images/pic.png' },
    ]

    renderWithTooltipProvider(<AssignmentArtifactsCell artifacts={artifacts} isCompact />)
    expect(screen.getAllByRole('button', { name: /view work items; artifact/i }).map((button) => button.textContent)).toEqual(['1', '2'])
  })

  it('renders a single artifact as a direct external link', () => {
    const artifacts: AssignmentArtifact[] = [
      { type: 'link', url: 'https://example.com/docs' },
    ]

    renderWithTooltipProvider(<AssignmentArtifactsCell artifacts={artifacts} isCompact={false} />)
    const artifactLink = screen.getByRole('link', { name: /open artifact 1: link/i })
    expect(artifactLink).toHaveAttribute('href', 'https://example.com/docs')
    expect(artifactLink).toHaveTextContent('1')
    fireEvent.click(artifactLink)
    expect(screen.queryByText('Open artifact')).not.toBeInTheDocument()
  })

  it('labels required submission artifacts with requirement titles', () => {
    const artifacts: AssignmentArtifact[] = [
      {
        type: 'link',
        url: 'https://demo.example.com',
        title: 'Published demo',
        is_required_submission: true,
        requirement_id: 'req-demo',
        requirement_required: true,
      },
      {
        type: 'repo',
        url: 'https://github.com/codepetca/pika',
        title: 'Source repo',
        is_required_submission: true,
        requirement_id: 'req-repo',
        requirement_required: true,
      },
      { type: 'link', url: 'https://example.com/free-note' },
    ]

    renderWithTooltipProvider(<AssignmentArtifactsCell artifacts={artifacts} isCompact />)

    const publishedDemoButton = screen.getByRole('button', {
      name: /required submission artifact 1 is published demo/i,
    })
    const sourceRepoButton = screen.getByRole('button', {
      name: /required submission artifact 2 is source repo/i,
    })
    const freeNoteButton = screen.getByRole('button', {
      name: /^View work items; artifact 3 is Link/i,
    })

    expect(within(publishedDemoButton).queryByText('R')).not.toBeInTheDocument()
    expect(within(sourceRepoButton).queryByText('R')).not.toBeInTheDocument()
    expect(within(freeNoteButton).queryByText('R')).not.toBeInTheDocument()
    expect(publishedDemoButton).toHaveClass('bg-info-bg-hover')
    expect(sourceRepoButton).toHaveClass('bg-info-bg-hover')
    expect(freeNoteButton).not.toHaveClass('bg-info-bg-hover')
    expect(freeNoteButton).not.toHaveAccessibleName(/required submission/i)

    fireEvent.click(publishedDemoButton)

    expect(screen.getByText(/Published demo . demo.example.com/i)).toBeInTheDocument()
    expect(screen.getByText(/Source repo . github.com\/codepetca\/pika/i)).toBeInTheDocument()
    expect(screen.getAllByText(/^Required submission \./)).toHaveLength(2)
  })

  it('includes required submission status in hover list link labels', async () => {
    const user = userEvent.setup()
    const artifacts: AssignmentArtifact[] = [
      {
        type: 'link',
        url: 'https://demo.example.com',
        title: 'Published demo',
        is_required_submission: true,
        requirement_id: 'req-demo',
        requirement_required: true,
      },
      { type: 'link', url: 'https://example.com/free-note' },
    ]

    renderWithTooltipProvider(<AssignmentArtifactsCell artifacts={artifacts} isCompact />)
    await user.hover(screen.getByRole('button', {
      name: /required submission artifact 1 is published demo/i,
    }))

    const tooltipLinks = await screen.findAllByRole('link', {
      name: /open required submission artifact 1: published demo/i,
    })
    expect(tooltipLinks.length).toBeGreaterThan(0)
    expect(tooltipLinks[0]).toHaveAttribute('href', 'https://demo.example.com')
  })

  it('opens a narrow chooser dialog for multiple artifacts', () => {
    const artifacts: AssignmentArtifact[] = [
      { type: 'link', url: 'https://example.com/docs' },
      { type: 'image', url: 'https://cdn.example.com/submission-images/pic.png' },
      {
        type: 'repo',
        url: 'https://github.com/codepetca/pika',
        repo_owner: 'codepetca',
        repo_name: 'pika',
        normalized_url: 'https://github.com/codepetca/pika',
      },
    ]

    renderWithTooltipProvider(<AssignmentArtifactsCell artifacts={artifacts} isCompact />)
    fireEvent.click(screen.getByRole('button', { name: /artifact 1 is link/i }))
    expect(screen.getByText('Open artifact')).toBeInTheDocument()
    expect(screen.getByText('3 work items')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /link . example.com\/docs/i })).toHaveAttribute('href', 'https://example.com/docs')
    expect(screen.getByRole('link', { name: /image . cdn.example.com\/submission-images/i })).toHaveAttribute('href', 'https://cdn.example.com/submission-images/pic.png')
    expect(screen.getByRole('link', { name: /repo . github.com\/codepetca\/pika/i })).toHaveAttribute('href', 'https://github.com/codepetca/pika')
  })

  it('shows all artifacts in a stacked tooltip list on hover', async () => {
    const user = userEvent.setup()
    const artifacts: AssignmentArtifact[] = [
      { type: 'link', url: 'https://example.com/docs' },
      { type: 'image', url: 'https://cdn.example.com/submission-images/pic.png' },
      {
        type: 'repo',
        url: 'https://github.com/codepetca/pika',
        repo_owner: 'codepetca',
        repo_name: 'pika',
        normalized_url: 'https://github.com/codepetca/pika',
      },
    ]

    renderWithTooltipProvider(<AssignmentArtifactsCell artifacts={artifacts} isCompact />)
    await user.hover(screen.getByRole('button', { name: /artifact 2 is image/i }))

    expect((await screen.findAllByText('3 artifacts')).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Link . example.com\/docs/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Image . cdn.example.com\/submission-images/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Repo . github.com\/codepetca\/pika/).length).toBeGreaterThan(0)
  })

  it('allows clicking artifact links from the hover list without opening the chooser', async () => {
    const user = userEvent.setup()
    const onParentClick = vi.fn()
    const artifacts: AssignmentArtifact[] = [
      { type: 'link', url: 'https://example.com/docs' },
      { type: 'image', url: 'https://cdn.example.com/submission-images/pic.png' },
    ]

    renderWithTooltipProvider(
      <div onClick={onParentClick}>
        <AssignmentArtifactsCell artifacts={artifacts} isCompact />
      </div>
    )
    await user.hover(screen.getByRole('button', { name: /artifact 2 is image/i }))

    const tooltipLinks = await screen.findAllByRole('link', {
      name: /open artifact 2: image . cdn\.example\.com\/submission-images/i,
    })
    const tooltipLink = tooltipLinks[0]
    expect(tooltipLink).toHaveAttribute('href', 'https://cdn.example.com/submission-images/pic.png')

    await user.click(tooltipLink)

    expect(onParentClick).not.toHaveBeenCalled()
    expect(screen.queryByText('Open artifact')).not.toBeInTheDocument()
  })

  it('labels repo artifacts distinctly in direct-link mode', () => {
    const artifacts: AssignmentArtifact[] = [
      {
        type: 'repo',
        url: 'https://github.com/codepetca/pika',
        repo_owner: 'codepetca',
        repo_name: 'pika',
        normalized_url: 'https://github.com/codepetca/pika',
      },
    ]

    renderWithTooltipProvider(<AssignmentArtifactsCell artifacts={artifacts} isCompact={false} />)
    expect(screen.getByRole('link', { name: /open artifact 1: repo/i })).toHaveAttribute('href', 'https://github.com/codepetca/pika')
  })
})
