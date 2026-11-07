import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CalendarActionBar } from '@/components/CalendarActionBar'
import { DateActionBar } from '@/components/DateActionBar'
import { DateLabelButton } from '@/components/DateLabelButton'
import { DateNavigator } from '@/components/DateNavigator'
import { TooltipProvider } from '@/ui'

describe('CalendarActionBar', () => {
  it('keeps the shared date label and subtitle tightly stacked', () => {
    render(
      <DateLabelButton
        label="Tue Sep 1"
        subtitle="Tomorrow"
        reserveSubtitleSpace
        ariaLabel="Select due date"
      />,
    )

    const dateButton = screen.getByRole('button', { name: 'Select due date' })
    expect(dateButton).toHaveClass('flex-col', 'gap-0')
    expect(dateButton).toHaveAccessibleDescription('Tomorrow')
  })

  it('uses the shared fixed-height date subtitle in the assignment action bar', () => {
    const { rerender } = render(
      <DateActionBar value="2026-09-01" subtitle="Tomorrow" onChange={vi.fn()} layout="compact" />,
    )

    const dateButton = screen.getByRole('button', { name: 'Tue Sep 1' })
    expect(dateButton).toHaveAccessibleDescription('Tomorrow')
    expect(within(dateButton).getByText('Tomorrow')).toHaveClass('leading-4', 'text-xs')

    rerender(<DateActionBar value="2026-09-01" onChange={vi.fn()} layout="compact" />)
    expect(dateButton).not.toHaveAccessibleDescription()
    expect(dateButton.querySelector('[aria-hidden="true"]')).toHaveClass('leading-4', 'text-xs')
  })

  it('exposes named date navigation controls', () => {
    const onPrev = vi.fn()
    const onNext = vi.fn()
    const onLabelClick = vi.fn()

    render(
      <DateNavigator
        label="July 2026"
        onPrev={onPrev}
        onNext={onNext}
        onLabelClick={onLabelClick}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    fireEvent.click(screen.getByRole('button', { name: 'Go to today' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(onPrev).toHaveBeenCalledOnce()
    expect(onLabelClick).toHaveBeenCalledOnce()
    expect(onNext).toHaveBeenCalledOnce()
  })

  it('can join the date arrows directly to a chevron-free date button', () => {
    render(
      <DateNavigator
        label="Aug 17"
        onPrev={vi.fn()}
        onNext={vi.fn()}
        onLabelClick={vi.fn()}
        joined
      />,
    )

    const dateButton = screen.getByRole('button', { name: 'Go to today' })
    expect(dateButton.parentElement).toHaveClass('overflow-hidden', 'border-border-strong')
    expect(screen.getByRole('button', { name: 'Previous' })).toHaveClass('border-r')
    expect(screen.getByRole('button', { name: 'Next' })).toHaveClass('border-l')
    expect(dateButton.querySelector('svg')).toBeNull()
  })

  it('renders an optional compact subtitle inside the date button', () => {
    const { rerender } = render(
      <DateNavigator
        label="Aug 17"
        subtitle="Yesterday"
        onLabelClick={vi.fn()}
      />,
    )

    const dateButton = screen.getByRole('button', { name: 'Go to today' })
    expect(dateButton).toHaveTextContent('Aug 17Yesterday')
    expect(dateButton).toHaveAccessibleDescription('Yesterday')
    expect(screen.getByText('Yesterday')).toHaveClass('text-xs', 'font-normal')

    rerender(<DateNavigator label="Aug 17" onLabelClick={vi.fn()} />)
    expect(dateButton).not.toHaveAttribute('aria-describedby')
    expect(dateButton).not.toHaveAccessibleDescription()
  })

  it('can reserve the subtitle line without exposing an empty description', () => {
    render(
      <DateNavigator
        label="Aug 18"
        reserveSubtitleSpace
        onLabelClick={vi.fn()}
      />,
    )

    const dateButton = screen.getByRole('button', { name: 'Go to today' })
    const reservedSubtitle = dateButton.querySelector('[aria-hidden="true"]')
    expect(dateButton).toHaveClass('flex-col', 'gap-0')
    expect(reservedSubtitle).toHaveClass('leading-4', 'text-xs')
    expect(dateButton).not.toHaveAttribute('aria-describedby')
    expect(dateButton).not.toHaveAccessibleDescription()
  })

  it('keeps a joined static date label vertically centered without a subtitle', () => {
    render(
      <DateNavigator
        label="All dates"
        showNavigation={false}
        joined
      />,
    )

    expect(screen.getByText('All dates').parentElement).toHaveClass(
      'flex',
      'min-h-control',
      'items-center',
      'justify-center',
    )
  })

  it('exposes the calendar view control and changes modes', () => {
    const onViewModeChange = vi.fn()
    const onToday = vi.fn()

    render(
      <CalendarActionBar
        viewMode="grid"
        currentDate={new Date(2026, 6, 21)}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        onToday={onToday}
        onViewModeChange={onViewModeChange}
      />,
    )

    const viewControl = screen.getByRole('group', { name: 'Calendar view' })
    expect(viewControl.closest('.fixed')).toBeNull()
    expect(viewControl).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Grid' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.keyDown(screen.getByRole('button', { name: 'Grid' }), { key: 'ArrowLeft' })
    expect(onViewModeChange).toHaveBeenCalledWith('list')
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(onToday).toHaveBeenCalledOnce()
  })

  it('keeps teacher calendar views centered and places secondary commands in More actions', () => {
    const onViewModeChange = vi.fn()
    const onMarkdownToggle = vi.fn()

    render(
      <TooltipProvider>
        <CalendarActionBar
          viewMode="grid"
          currentDate={new Date(2026, 6, 21)}
          onPrev={vi.fn()}
          onNext={vi.fn()}
          onToday={vi.fn()}
          onViewModeChange={onViewModeChange}
          moreActions={[
            {
              id: 'markdown',
              label: 'Edit calendar in Markdown',
              checked: false,
              checkedRole: 'menuitemcheckbox',
              dividerBefore: true,
              onSelect: onMarkdownToggle,
            },
          ]}
        />
      </TooltipProvider>,
    )

    const viewControl = screen.getByRole('group', { name: 'Calendar view' })
    expect(viewControl).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Grid' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'More actions' })).toHaveClass('h-6', 'w-11')

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))

    expect(screen.queryByRole('menuitemradio')).not.toBeInTheDocument()
    expect(screen.getByRole('menuitemcheckbox', { name: 'Edit calendar in Markdown' })).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'List' }))
    expect(onViewModeChange).toHaveBeenCalledWith('list')
  })
})
