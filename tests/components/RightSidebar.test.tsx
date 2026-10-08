import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RightSidebar } from '@/components/layout/RightSidebar'
import { TooltipProvider } from '@/ui'

const close = vi.fn()
let isRightOpen = true

vi.mock('@/components/layout/ThreePanelProvider', () => ({
  useRightSidebar: () => ({ isOpen: true, enabled: true }),
  useMobileDrawer: () => ({ isRightOpen, close }),
  useThreePanel: () => ({}),
}))

vi.mock('@/hooks/use-keyboard-shortcut-hint', () => ({
  useKeyboardShortcutHint: () => ({ rightPanel: ']' }),
}))

describe('RightSidebar mobile drawer', () => {
  beforeEach(() => {
    close.mockReset()
    isRightOpen = true
  })

  it.each([false, true])('preserves the modal and Back command with minimal header %s', async (minimalMobileHeader) => {
    const { container, unmount } = render(
      <TooltipProvider>
        <RightSidebar title="Example details" minimalMobileHeader={minimalMobileHeader}>
          <button type="button">Review work</button>
        </RightSidebar>
      </TooltipProvider>,
    )

    expect(screen.getByRole('dialog', { name: 'Example details' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Back' })).toHaveFocus())
    expect(container).toHaveAttribute('aria-hidden', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(close).toHaveBeenCalledOnce()
    close.mockClear()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(close).toHaveBeenCalledOnce()

    unmount()
    expect(document.body.style.overflow).toBe('')
  })
})
