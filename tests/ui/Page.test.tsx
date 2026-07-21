import { fireEvent, render, screen, within } from '@testing-library/react'
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

describe('Page primitives', () => {
  it('applies canonical content widths without feature-local max-width classes', () => {
    const { rerender } = render(<PageLayout width="reading">Content</PageLayout>)

    expect(screen.getByText('Content')).toHaveClass('max-w-2xl', 'mx-auto', 'w-full')

    rerender(<PageLayout width="standard">Content</PageLayout>)
    expect(screen.getByText('Content')).toHaveClass('max-w-4xl')
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
    expect(stack).toHaveClass('space-y-3')
    expect(stack.parentElement).toHaveClass('px-3', 'pt-2')
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

  it('keeps the mobile title and overflow action in one stable row', () => {
    render(
      <PageActionBar
        primary={<PageHeading title="Classrooms" />}
        actions={[{ id: 'join', label: 'Join classroom', onSelect: vi.fn() }]}
      />,
    )

    const row = screen.getByRole('heading', { name: 'Classrooms' }).parentElement?.parentElement
      ?.parentElement
    expect(row).toHaveClass('flex', 'items-start', 'gap-3')
    expect(
      screen.getByRole('button', { name: 'Open actions menu' }).parentElement?.parentElement,
    ).toHaveClass('shrink-0', 'sm:hidden')
  })

  it('preserves 44px targets and focus treatment for action buttons and menu items', () => {
    expect(ACTIONBAR_BUTTON_CLASSNAME).toContain('min-h-11')
    expect(ACTIONBAR_BUTTON_CLASSNAME).not.toContain('min-h-10')
    expect(ACTIONBAR_ICON_BUTTON_CLASSNAME).toContain('h-11')
    expect(ACTIONBAR_ICON_BUTTON_CLASSNAME).toContain('w-11')

    render(
      <PageActionBar
        primary="Actions"
        actions={[{ id: 'archive', label: 'Archive', onSelect: vi.fn() }]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open actions menu' }))

    const item = within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Archive' })
    expect(item).toHaveClass('min-h-11', 'focus-visible:ring-2', 'focus-visible:ring-inset')
  })
})
