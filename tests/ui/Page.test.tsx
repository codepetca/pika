import type { ReactNode } from 'react'
import { TooltipProvider } from '@/ui'
import { fireEvent, render as renderRTL, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  ACTIONBAR_BUTTON_CLASSNAME,
  ACTIONBAR_ICON_BUTTON_CLASSNAME,
  PageActionBar,
  PageContent,
  PageHeading,
  PageLayout,
  PageStack,
} from '@/ui'

function render(ui: ReactNode) { return renderRTL(<TooltipProvider>{ui}</TooltipProvider>) }

describe('Page primitives', () => {
  it('applies canonical content widths without feature-local max-width classes', () => {
    const { rerender } = render(<PageLayout width="reading">Content</PageLayout>)

    expect(screen.getByText('Content')).toHaveClass('max-w-reading', 'mx-auto', 'w-full')

    rerender(<PageLayout width="standard">Content</PageLayout>)
    expect(screen.getByText('Content')).toHaveClass('max-w-standard')
  })

  it('preserves legacy className width overrides during migration', () => {
    render(<PageLayout className="mx-auto max-w-7xl">Legacy width</PageLayout>)

    expect(screen.getByText('Legacy width')).toHaveClass('mx-auto', 'max-w-7xl')
    expect(screen.getByText('Legacy width')).not.toHaveClass('max-w-none')
  })

  it('propagates the selected density to content gutters and stack spacing', () => {
    render(
      <PageLayout density="teacher">
        <PageContent>
          <PageStack>Dense teacher content</PageStack>
        </PageContent>
      </PageLayout>,
    )

    const stack = screen.getByText('Dense teacher content')
    expect(stack).toHaveClass('space-y-density-compact-stack-gap')
    expect(stack.parentElement).toHaveClass(
      'px-density-compact-gutter',
      'pt-density-compact-content-top',
    )
  })

  it('provides semantic page and section heading levels with governed typography', () => {
    const { rerender } = render(<PageHeading title="Classrooms" description="Current courses" />)

    expect(screen.getByRole('heading', { level: 1, name: 'Classrooms' })).toHaveClass(
      'text-2xl',
      'font-semibold',
    )
    expect(screen.getByText('Current courses')).toHaveClass('text-sm')

    rerender(<PageHeading level="h2" size="section" title="Archived" />)
    expect(screen.getByRole('heading', { level: 2, name: 'Archived' })).toHaveClass(
      'text-sm',
      'font-semibold',
    )
  })

  it('keeps the title and overflow action in one stable row', () => {
    render(
      <PageActionBar
        primary={<PageHeading title="Classrooms" />}
        actions={[{ id: 'join', label: 'Join classroom', onSelect: vi.fn() }]}
      />,
    )

    const row = screen.getByRole('heading', { name: 'Classrooms' }).parentElement?.parentElement
      ?.parentElement
    expect(row).toHaveClass('flex', 'items-center', 'gap-3')
    expect(
      screen.getByRole('button', { name: 'More actions' }).parentElement?.parentElement?.parentElement,
    ).toHaveClass('flex', 'items-center', 'gap-3')
    expect(screen.getByRole('button', { name: 'More actions' })).toHaveClass(
      'border-transparent',
      'bg-transparent',
      'text-text-muted',
    )
  })

  it('preserves 44px targets and focus treatment for action buttons and menu items', () => {
    expect(ACTIONBAR_BUTTON_CLASSNAME).toContain('min-h-control')
    expect(ACTIONBAR_BUTTON_CLASSNAME).not.toContain('min-h-10')
    expect(ACTIONBAR_ICON_BUTTON_CLASSNAME).toContain('h-11')
    expect(ACTIONBAR_ICON_BUTTON_CLASSNAME).toContain('w-11')

    render(
      <PageActionBar
        primary="Actions"
        actions={[{ id: 'archive', label: 'Archive', onSelect: vi.fn() }]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))

    const item = within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Archive' })
    expect(item).toHaveClass(
      'min-h-control',
      'focus-visible:ring-foundation',
      'focus-visible:ring-inset',
    )
  })

  it('does not reclaim focus with menu keys after focus leaves the open menu', async () => {
    const user = userEvent.setup()
    render(
      <>
        <PageActionBar
          primary="Actions"
          actions={[{ id: 'archive', label: 'Archive', onSelect: vi.fn() }]}
        />
        <button type="button">After menu</button>
      </>,
    )

    await user.click(screen.getByRole('button', { name: 'More actions' }))
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Archive' })).toHaveFocus())

    await user.tab()
    const nextAction = screen.getByRole('button', { name: 'After menu' })
    expect(nextAction).toHaveFocus()

    await user.keyboard('{ArrowDown}{Escape}')

    expect(nextAction).toHaveFocus()
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })
})
