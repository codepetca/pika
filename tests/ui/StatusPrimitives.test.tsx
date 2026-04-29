import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AppMessageProvider, RefreshingIndicator, TabContentTransition } from '@/ui'

describe('status primitives', () => {
  it('renders the refreshing indicator through the fixed overlay status label', async () => {
    render(
      <AppMessageProvider>
        <RefreshingIndicator />
      </AppMessageProvider>,
    )

    const status = await screen.findByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveTextContent('Refreshing')
    expect(screen.getByTestId('app-message-overlay')).toHaveClass('fixed', 'pointer-events-none')
  })

  it('renders the refreshing indicator with a custom overlay label without layout classes', async () => {
    render(
      <AppMessageProvider>
        <RefreshingIndicator label="Syncing grades" className="mb-2" />
      </AppMessageProvider>,
    )

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Syncing grades')
    expect(screen.getByTestId('app-message-overlay')).not.toHaveClass('mb-2')
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
