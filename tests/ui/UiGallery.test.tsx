import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { UiGallery } from '@/app/__ui/UiGallery'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { TooltipProvider } from '@/ui'

vi.mock('@/components/HistoryGraph', () => ({
  HistoryGraph: () => <div data-testid="history-graph" />,
}))

vi.mock('@/components/editor', () => ({
  RichTextEditor: () => <div />,
  RichTextViewer: () => <div />,
}))

function renderGallery(role: 'teacher' | 'student' = 'teacher') {
  return render(
    <ThemeProvider>
      <TooltipProvider>
        <UiGallery role={role} />
      </TooltipProvider>
    </ThemeProvider>,
  )
}

describe('UiGallery accessibility contracts', () => {
  // Exercise StudentTestListItem through its real gallery composition, including disabled-card tab order.
  it.each(['teacher', 'student'] as const)('demonstrates student Test access and keyboard selection for %s reviewers', async (role) => {
    const user = userEvent.setup()
    renderGallery(role)
    const examples = within(screen.getByTestId('pattern-section-student-tests'))
    const available = examples.getByRole('button', { name: /Functions and Graphs/ })
    const closed = examples.getByRole('button', { name: /Polynomial Expressions/ })
    const submitted = examples.getByRole('button', { name: /Linear Equations/ })
    expect(closed).toBeDisabled()
    expect(examples.getByRole('button', { name: /Quadratic Relations/ })).toHaveTextContent('Awaiting results · Access closed')
    expect(examples.getByRole('button', { name: /Rates of Change/ })).toHaveTextContent('Returned')
    available.focus()
    await user.keyboard('{Enter}')
    expect(available).toHaveAttribute('aria-current', 'true')
    expect(examples.getByRole('status')).toHaveTextContent('Selected example: Functions and Graphs')
    await user.tab()
    expect(submitted).toHaveFocus()
    await user.keyboard(' ')
    expect(submitted).toHaveAttribute('aria-current', 'true')
    expect(available).not.toHaveAttribute('aria-current')
  })

  it('keeps section navigation and composite controls explicitly named', () => {
    renderGallery('student')

    expect(screen.getByRole('navigation', { name: 'Pattern Lab sections' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Find a pattern' })).toBeInTheDocument()
    expect(screen.getByRole('tablist', { name: 'Pattern example panels' })).toBeInTheDocument()
    const detailsTab = screen.getByRole('tab', { name: 'Details' })
    const historyTab = screen.getByRole('tab', { name: 'History' })
    expect(detailsTab).toHaveAttribute(
      'aria-controls',
      'pattern-details-panel',
    )
    expect(historyTab).toHaveAttribute('aria-controls', 'pattern-history-panel')
    expect(screen.getByRole('tabpanel', { name: 'Details' })).toHaveAttribute(
      'aria-labelledby',
      'pattern-details-tab',
    )
    expect(within(screen.getByTestId('pattern-section-controls')).getAllByRole('tabpanel', { hidden: true })).toHaveLength(2)
    for (const tab of [detailsTab, historyTab]) {
      expect(document.getElementById(tab.getAttribute('aria-controls')!)).toBeInTheDocument()
    }
    expect(screen.getByRole('group', { name: 'Content density' })).toBeInTheDocument()
    expect(screen.getByText('student reference')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Student history' })).toHaveAttribute(
      'href',
      '/student/history',
    )
    expect(screen.queryByRole('link', { name: 'Snapshot gallery' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('teacher-pattern-examples')).not.toBeInTheDocument()
  })

  it('jumps directly to specific patterns from the persistent navigator', async () => {
    const user = userEvent.setup()
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })
    renderGallery('teacher')

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Find a pattern' }),
      'page-mockups',
    )

    expect(window.location.hash).toBe('#page-mockups')
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    expect(screen.getByRole('link', { name: 'Page mockups' })).toHaveAttribute(
      'href',
      '#page-mockups',
    )
  })

  it('keeps page mockups teacher-only and exposes named interactive owners', async () => {
    const user = userEvent.setup()
    const { unmount } = renderGallery('teacher')
    expect(screen.getByRole('link', { name: 'Page mockups' })).toHaveAttribute('href', '#page-mockups')
    const mockups = within(screen.getByTestId('page-mockups'))
    expect(mockups.getByRole('tablist', { name: 'Classroom page mockups' })).toBeInTheDocument()
    expect(mockups.getByRole('group', { name: 'Score display' })).toBeInTheDocument()
    expect(mockups.getByRole('button', { name: 'More actions' })).toHaveAttribute('aria-haspopup', 'menu')
    expect(mockups.getByRole('table')).toBeInTheDocument()
    for (const name of ['Gradebook', 'Calendar', 'Announcements', 'Roster']) {
      const tab = mockups.getByRole('tab', { name })
      expect(document.getElementById(tab.getAttribute('aria-controls')!)).toBeInTheDocument()
    }
    await user.selectOptions(mockups.getByRole('combobox', { name: 'Example state' }), 'error')
    await user.click(mockups.getByRole('button', { name: 'Try loading gradebook again' }))
    expect(mockups.getByRole('table')).toBeInTheDocument()
    await user.click(mockups.getByRole('checkbox', { name: 'Select Maya Chen' }))
    await user.click(mockups.getByRole('button', { name: 'Selected students (1)' }))
    await user.click(mockups.getByRole('menuitem', { name: 'Email 1 selected' }))
    expect(mockups.getByRole('status')).toHaveTextContent('Email students selected. Example only')
    await user.click(mockups.getByRole('tab', { name: 'Announcements' }))
    expect(mockups.getByRole('tabpanel', { name: 'Announcements' })).toBeVisible()
    await user.click(mockups.getByRole('button', { name: 'Create announcement' }))
    expect(mockups.getByRole('status')).toHaveTextContent('Create announcement selected. Example only')
    unmount()
    renderGallery('student')
    expect(screen.queryByTestId('page-mockups')).not.toBeInTheDocument()
  })

  it('moves tab focus and selection with arrow keys', () => {
    renderGallery()

    const detailsTab = screen.getByRole('tab', { name: 'Details' })
    fireEvent.keyDown(detailsTab, { key: 'ArrowRight' })

    expect(screen.getByRole('tab', { name: 'History' })).toHaveFocus()
    expect(screen.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: 'History' })).toHaveTextContent(
      'History is another panel',
    )
    expect(within(screen.getByTestId('pattern-section-controls')).getAllByRole('tabpanel', { hidden: true })).toHaveLength(2)
    expect(document.getElementById('pattern-details-panel')).toBeInTheDocument()
  })

  it('opens and dismisses the canonical alert dialog', () => {
    renderGallery()

    fireEvent.click(screen.getByRole('button', { name: 'Open alert dialog' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Pattern confirmed' })
    expect(dialog).toHaveAccessibleDescription('This dialog is rendered by the canonical shared owner.')
    expect(within(dialog).getByRole('button', { name: 'Close example' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close example' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})
