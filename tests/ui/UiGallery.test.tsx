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
  it.each(['teacher', 'student'] as const)('locates the separate Owned / Joined home for %s reviewers', async (role) => {
    const user = userEvent.setup()
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    renderGallery(role)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Find a pattern' }), 'owned-joined-home')
    expect(window.location.hash).toBe('#owned-joined-home')
    expect(scrollIntoView).toHaveBeenCalled()
    const home = within(screen.getByTestId('pattern-section-owned-joined-home'))
    expect(home.getByRole('heading', { name: 'Owned / Joined home' })).toBeVisible()
    expect(home.getByRole('group', { name: 'Classroom relationship' })).toBeVisible()
    expect(home.getByRole('combobox', { name: 'Creation access' })).toBeVisible()
  })

  it.each(['teacher', 'student'] as const)('includes the student Grades visibility switch for %s reviewers', (role) => {
    renderGallery(role)

    const example = within(screen.getByTestId('student-grades-pattern'))
    expect(example.getByRole('switch', { name: 'Show grades to students' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(example.getByTestId('student-grades-visible-preview')).toBeVisible()
  })

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
    expect(screen.getByRole('group', { name: 'Pattern Lab role' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Student' })).toHaveAttribute('aria-pressed', 'true')
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
    expect(screen.getByRole('heading', { name: 'Classroom navigation' })).toBeInTheDocument()
    expect(screen.getAllByText('ClipboardCheck', { exact: true })).toHaveLength(2)
    expect(screen.getByText('SquarePen', { exact: true })).toBeInTheDocument()
    expect(screen.getByText('Compass', { exact: true })).toBeInTheDocument()
    const icons = within(screen.getByTestId('pattern-section-icons'))
    expect(icons.getByRole('heading', { name: 'Eye' })).toBeInTheDocument()
    expect(icons.getByText('Preview content')).toBeInTheDocument()
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
    expect(within(screen.getByRole('navigation', { name: 'Pattern Lab sections' })).getByRole('link', { name: 'Page mockups' })).toHaveAttribute(
      'href',
      '#page-mockups',
    )

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Find a pattern' }),
      'status-colors',
    )
    expect(window.location.hash).toBe('#status-colors')
    expect(scrollIntoView).toHaveBeenCalledTimes(2)

    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Find a pattern' }),
      'mockup-settings-panel',
    )
    expect(window.location.hash).toBe('#mockup-settings-panel')
    expect(within(screen.getByTestId('page-mockups')).getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: 'Settings' })).toBeVisible()
    expect(scrollIntoView).toHaveBeenCalledTimes(3)
    requestAnimationFrame.mockRestore()
  })

  it('exposes role-appropriate page mockups and named interactive owners', async () => {
    const user = userEvent.setup()
    const { unmount } = renderGallery('teacher')
    expect(within(screen.getByRole('navigation', { name: 'Pattern Lab sections' })).getByRole('link', { name: 'Page mockups' })).toHaveAttribute('href', '#page-mockups')
    const mockups = within(screen.getByTestId('page-mockups'))
    expect(mockups.getByRole('tablist', { name: 'Teacher classroom page mockups' })).toBeInTheDocument()
    await user.click(mockups.getByRole('tab', { name: 'Gradebook' }))
    expect(mockups.queryByText('Semester 1 · 4 students')).not.toBeInTheDocument()
    expect(mockups.queryByRole('columnheader', { name: 'Preview' })).not.toBeInTheDocument()
    expect(mockups.queryByRole('button', { name: "Preview Maya's grades" })).not.toBeInTheDocument()
    expect(mockups.getByRole('button', { name: 'Student Actions' })).toBeDisabled()
    expect(mockups.getByRole('button', { name: 'More actions' })).toHaveAttribute('aria-haspopup', 'menu')
    const gradebookTable = mockups.getByRole('table')
    expect(gradebookTable).toBeInTheDocument()
    expect(gradebookTable.querySelectorAll('col')).toHaveLength(16)
    expect(gradebookTable.querySelectorAll('col')[3]).toHaveStyle({ width: '88px' })
    for (const assessment of ['Ecosystems', 'Cells', 'Genetics', 'Reactions', 'Motion', 'Climate', 'Circuits', 'Space', 'Energy', 'Waves', 'Matter', 'Sustainability']) {
      expect(mockups.getByRole('columnheader', { name: assessment })).toBeInTheDocument()
    }
    await user.click(mockups.getByRole('button', { name: 'More actions' }))
    expect(mockups.getByRole('menuitem', { name: 'Edit categories' })).toBeInTheDocument()
    expect(mockups.getByRole('menuitem', { name: 'Show last name in column 1' })).toBeInTheDocument()
    expect(mockups.queryByRole('menuitemradio')).not.toBeInTheDocument()
    expect(mockups.getByRole('menuitemcheckbox', { name: 'Show student IDs' })).toHaveAttribute('aria-checked', 'false')
    expect(mockups.getByRole('menuitemcheckbox', { name: 'Keep key columns visible' })).toHaveAttribute('aria-checked', 'true')
    await user.click(mockups.getByRole('menuitemcheckbox', { name: 'Show student IDs' }))
    expect(mockups.getByRole('columnheader', { name: 'ID' })).toBeInTheDocument()
    expect(mockups.getByRole('cell', { name: '1004832' })).toBeInTheDocument()
    const scoreDisplay = within(mockups.getByRole('group', { name: 'Score display' }))
    await user.click(scoreDisplay.getByRole('button', { name: 'x/y' }))
    const mayaRow = mockups.getByRole('row', { name: /Maya Chen/ })
    expect(within(mayaRow).getByRole('cell', { name: '18/20' })).toBeInTheDocument()
    expect(within(mayaRow).getByRole('cell', { name: '42/50' })).toBeInTheDocument()
    expect(scoreDisplay.getByRole('button', { name: 'x/y' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(scoreDisplay.getByRole('button', { name: '%' }))
    expect(scoreDisplay.getByRole('button', { name: '%' })).toHaveAttribute('aria-pressed', 'true')
    for (const name of ['Daily', 'Classrooms', 'Gradebook', 'Calendar', 'Announcements', 'Roster', 'Settings', 'Workspaces']) {
      const tab = mockups.getByRole('tab', { name })
      expect(document.getElementById(tab.getAttribute('aria-controls')!)).toBeInTheDocument()
    }
    await user.selectOptions(mockups.getByRole('combobox', { name: 'Example state' }), 'error')
    await user.click(mockups.getByRole('button', { name: 'Try loading gradebook again' }))
    expect(mockups.getByRole('table')).toBeInTheDocument()
    await user.click(mockups.getByRole('checkbox', { name: 'Select Maya Chen' }))
    await user.click(mockups.getByRole('button', { name: '1 selected' }))
    expect(mockups.getByRole('menuitem', { name: 'Copy email 2' })).toBeInTheDocument()
    await user.click(mockups.getByRole('menuitem', { name: 'Copy emails' }))
    expect(mockups.getByRole('status')).toHaveTextContent('Copy emails selected. Example only')
    await user.click(mockups.getByRole('tab', { name: 'Announcements' }))
    expect(mockups.getByRole('tabpanel', { name: 'Announcements' })).toBeVisible()
    await user.click(mockups.getByRole('button', { name: 'Create announcement' }))
    expect(mockups.getByRole('status')).toHaveTextContent('Create announcement selected. Example only')
    unmount()
    renderGallery('student')
    const studentMockups = within(screen.getByTestId('page-mockups'))
    expect(studentMockups.getByRole('tablist', { name: 'Student classroom page mockups' })).toBeInTheDocument()
    expect(studentMockups.getByRole('tab', { name: 'Today' })).toHaveAttribute('aria-selected', 'true')
    expect(studentMockups.getByTestId('student-today-mockup')).toBeVisible()
  }, 15_000)

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
