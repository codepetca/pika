import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { LeftSidebar } from '@/components/layout/LeftSidebar'
import { TooltipProvider } from '@/ui'

const close = vi.fn()
const onNavigateHome = vi.fn(() => true)
let isLeftOpen = true

vi.mock('@/components/layout/ThreePanelProvider', () => ({
  useLeftSidebar: () => ({ isExpanded: true, toggle: vi.fn() }),
  useMobileDrawer: () => ({ isLeftOpen, close }),
}))

describe('LeftSidebar mobile drawer', () => {
  beforeEach(() => {
    close.mockReset()
    onNavigateHome.mockClear()
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

  it('offers a Pika home link in the mobile drawer', () => {
    render(
      <TooltipProvider>
        <LeftSidebar mobileHomeHref="/classrooms" onNavigateHome={onNavigateHome}>
          <a href="/attendance">Attendance</a>
        </LeftSidebar>
      </TooltipProvider>,
    )

    const homeLink = within(screen.getByRole('dialog', { name: 'Navigation menu' }))
      .getByRole('link', { name: 'All classrooms' })

    expect(homeLink).toHaveAttribute('href', '/classrooms')
    expect(homeLink).toHaveTextContent('All classrooms')
    expect(homeLink).toHaveClass('bg-surface-2', 'hover:bg-surface-hover')
    expect(within(homeLink).getByAltText('Pika')).toBeInTheDocument()
    expect(homeLink.querySelector('.lucide-chevron-right')).not.toBeInTheDocument()
    expect(within(screen.getByRole('dialog', { name: 'Navigation menu' })).getByText('Navigation'))
      .toBeInTheDocument()

    homeLink.addEventListener('click', (event) => event.preventDefault())
    fireEvent.click(homeLink)

    expect(onNavigateHome).toHaveBeenCalledWith('/classrooms')
    expect(close).toHaveBeenCalledOnce()
  })

  it('keeps the drawer open when home navigation is blocked', () => {
    onNavigateHome.mockReturnValueOnce(false)
    render(
      <TooltipProvider>
        <LeftSidebar mobileHomeHref="/classrooms" onNavigateHome={onNavigateHome}>
          <a href="/attendance">Attendance</a>
        </LeftSidebar>
      </TooltipProvider>,
    )

    fireEvent.click(screen.getByRole('link', { name: 'All classrooms' }))

    expect(close).not.toHaveBeenCalled()
  })
})
