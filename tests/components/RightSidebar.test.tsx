import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RightSidebar } from '@/components/layout/RightSidebar'

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

  it('uses the shared modal contract and focuses its back control', async () => {
    const { container, unmount } = render(
      <RightSidebar title="Student details">
        <button type="button">Review work</button>
      </RightSidebar>,
    )

    expect(screen.getByRole('dialog', { name: 'Student details' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Back' })).toHaveFocus())
    expect(container).toHaveAttribute('aria-hidden', 'true')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(close).toHaveBeenCalledOnce()

    unmount()
    expect(document.body.style.overflow).toBe('')
  })
})
