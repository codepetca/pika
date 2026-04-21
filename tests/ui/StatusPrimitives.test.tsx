import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { RefreshingIndicator, TabContentTransition } from '@/ui'

describe('status primitives', () => {
  it('renders the refreshing indicator with the default polite status label', () => {
    render(<RefreshingIndicator />)

    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveTextContent('Refreshing...')
    expect(status.className).toContain('text-text-muted')
  })

  it('renders the refreshing indicator with a custom label and class name', () => {
    render(<RefreshingIndicator label="Syncing grades..." className="mb-2" />)

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Syncing grades...')
    expect(status.className).toContain('mb-2')
  })

  it('shows active tab content with visible transition classes', () => {
    render(
      <TabContentTransition isActive className="grow">
        <div>Visible panel</div>
      </TabContentTransition>
    )

    const panel = screen.getByText('Visible panel').parentElement
    expect(panel).toHaveAttribute('aria-hidden', 'false')
    expect(panel?.className).toContain('opacity-100')
    expect(panel?.className).toContain('flex')
    expect(panel?.className).toContain('grow')
  })

  it('hides inactive tab content while keeping the children mounted', () => {
    render(
      <TabContentTransition isActive={false}>
        <div>Hidden panel</div>
      </TabContentTransition>
    )

    const panel = screen.getByText('Hidden panel').parentElement
    expect(panel).toHaveAttribute('aria-hidden', 'true')
    expect(panel?.className).toContain('hidden')
    expect(panel?.className).toContain('opacity-0')
  })
})
