import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { LeftSidebar } from '@/components/layout/LeftSidebar'
import { TooltipProvider } from '@/ui'

const close = vi.fn()
let isLeftOpen = true

vi.mock('@/components/layout/ThreePanelProvider', () => ({
  useLeftSidebar: () => ({ isExpanded: true, toggle: vi.fn() }),
  useMobileDrawer: () => ({ isLeftOpen, close }),
}))

describe('LeftSidebar mobile drawer', () => {
  beforeEach(() => {
    close.mockReset()
    isLeftOpen = true
  })

  it('uses the shared modal contract and focuses its close control', async () => {
    const { container, unmount } = render(
      <TooltipProvider>
        <LeftSidebar>
          <a href="/attendance">Attendance</a>
        </LeftSidebar>
      </TooltipProvider>,
    )

    const dialog = screen.getByRole('dialog', { name: 'Navigation menu' })
    expect(dialog).toBeInTheDocument()
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Close navigation' })).toHaveFocus())
    expect(container).toHaveAttribute('aria-hidden', 'true')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(close).toHaveBeenCalledOnce()

    unmount()
    expect(document.body.style.overflow).toBe('')
  })
})
