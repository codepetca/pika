import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { UiGallery } from '@/app/__ui/UiGallery'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { TooltipProvider } from '@/ui'

vi.mock('@/components/HistoryGraph', () => ({
  HistoryGraph: () => <div data-testid="history-graph" />,
}))

vi.mock('@/components/editor', () => ({
  MarkdownContentEditor: () => <div />,
  RichTextEditor: () => <div />,
  RichTextViewer: () => <div />,
}))

function renderGallery(role: 'teacher' | 'student' = 'teacher', assignmentControllerFixture = false) {
  return render(
    <ThemeProvider>
      <TooltipProvider>
        <UiGallery role={role} assignmentControllerFixture={assignmentControllerFixture} />
      </TooltipProvider>
    </ThemeProvider>,
  )
}

describe('UiGallery accessibility contracts', () => {
  it.each(['teacher', 'student'] as const)('keeps AssignmentControllerPattern absent from ordinary %s references', role => {
    renderGallery(role)
    expect(screen.queryByTestId('assignment-controller-fixture')).not.toBeInTheDocument()
  })

  it('renders the explicitly enabled teacher fixture closed', () => {
    renderGallery('teacher', true)
    const fixture = within(screen.getByTestId('assignment-controller-fixture'))
    expect(fixture.getByRole('button', { name: 'Open controlled assignment' })).toBeVisible()
    // AssignmentModal portals outside the fixture section; keep this global assertion.
    expect(screen.queryByRole('dialog', { name: 'Edit Draft' })).not.toBeInTheDocument()
  })

  it('keeps the enabled AssignmentControllerPattern absent for students', () => {
    renderGallery('student', true)
    expect(screen.queryByTestId('assignment-controller-fixture')).not.toBeInTheDocument()
  })

  it.each(['teacher', 'student'] as const)('UiConsistencyPattern retires the plain split menu before its %s visual exit', role => {
    renderGallery(role)
    const section = document.getElementById('ui-consistency')!
    const example = within(section)
    const trigger = example.getByRole('button', { name: 'Example actions' })
    fireEvent.click(trigger)
    const menu = example.getByRole('menu')
    menu.style.setProperty('--motion-duration-fast', '150ms')
    const command = within(menu).getByRole('menuitem', { name: 'First action' })
    expect(command).toHaveFocus()
    expect(within(menu).getByRole('menuitem', { name: 'Unavailable action' })).toBeDisabled()
    fireEvent.keyDown(command, { key: 'Escape' })
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(example.queryByRole('menu')).not.toBeInTheDocument()
    const closing = section.querySelector<HTMLElement>('[data-menu-closing]')
    expect(closing).toBeInTheDocument()
    expect(closing).toHaveAttribute('aria-hidden', 'true')
    expect(closing?.inert).toBe(true)
    expect(closing).not.toContainElement(command)
    fireEvent.click(command)
    expect(example.getByRole('status')).toHaveTextContent('No action selected')
    fireEvent.click(trigger)
    fireEvent.keyDown(example.getByRole('menuitem', { name: 'First action' }), { key: 'End' })
    expect(example.getByRole('menuitem', { name: 'Last action' })).toHaveFocus()
    fireEvent.click(example.getByRole('menuitem', { name: 'Last action' }))
    expect(example.getByRole('status')).toHaveTextContent('Last selected')
    expect(section.querySelector<HTMLElement>('[data-menu-closing]')).not.toBeInTheDocument()
  })

  it.each(['teacher', 'student'] as const)('previews shared menu retirement and dialog focus handoff for %s', role => {
    renderGallery(role)
    const example = within(screen.getByTestId('page-action-icons-example'))
    const trigger = example.getByRole('button', { name: 'More actions' })
    fireEvent.click(trigger)
    const menu = example.getByRole('menu')
    menu.style.setProperty('--motion-duration-fast', '150ms')
    const command = within(menu).getByRole('menuitem', { name: 'Export assignments' })
    expect(within(menu).getByRole('menuitem', { name: 'Archive selected' })).toBeDisabled()
    fireEvent.keyDown(command, { key: 'Escape' })
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(menu).toHaveAttribute('aria-hidden', 'true')
    expect(menu.inert).toBe(true)
    fireEvent.click(command)
    expect(screen.queryByRole('alertdialog', { name: 'Pattern confirmed' })).not.toBeInTheDocument()
    fireEvent.click(trigger)
    fireEvent.click(example.getByRole('menuitem', { name: 'Export assignments' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Pattern confirmed' })
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
    expect(menu).not.toBeInTheDocument()
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' })
    expect(trigger).toHaveFocus()
  })

  it.each(['teacher', 'student'] as const)('shows default and opt-in FormField semantics independently for %s', role => {
    renderGallery(role)
    const controls = within(screen.getByTestId('pattern-section-controls'))
    const empty = controls.getByRole('textbox', { name: 'Reserved error space' })
    expect(empty).not.toHaveAttribute('aria-invalid')
    expect(empty).not.toHaveAttribute('aria-errormessage')
    const failed = controls.getByRole('textbox', { name: 'Reserved error with hint' })
    expect(failed).toHaveAttribute('aria-invalid', 'true')
    expect(failed).toHaveAccessibleDescription('The hint remains visible during recovery. Request failed. Please try again.')
    expect(controls.getByText('Request failed. Please try again.')).toHaveAttribute('role', 'alert')
    const defaultField = controls.getByRole('textbox', { name: 'Class name' })
    expect(defaultField).toHaveAccessibleDescription('Use the name students already recognize.')
    expect(defaultField).not.toHaveAttribute('aria-invalid')
  })

  it.each(['teacher', 'student'] as const)('keeps loading names and busy semantics with decorative circular progress for %s', (role) => {
    renderGallery(role)
    const example = screen.getByTestId('circular-progress-example')
    const status = within(example).getByRole('status')
    expect(status).toHaveTextContent('Loading classroom')
    expect(status).toHaveAttribute('aria-busy', 'true')
    for (const name of ['Creating class', 'Creating classroom']) {
      const button = within(example).getByRole('button', { name, exact: true })
      expect(button).toBeDisabled()
      expect(button).toHaveAttribute('aria-busy', 'true')
    }
    for (const icon of example.querySelectorAll('svg')) {
      expect(icon).toHaveAttribute('aria-hidden', 'true')
    }
  })

  it.each(['teacher', 'student'] as const)('returns focus and confirms only the explicit local action for %s', async (role) => {
    const user = userEvent.setup()
    renderGallery(role)
    const controls = within(screen.getByTestId('pattern-section-controls'))
    const opener = controls.getByRole('button', { name: 'Open confirmation dialog' })
    const activeConfirmation = () => {
      const layer = document.querySelector<HTMLElement>('[data-modal-state="open"]')
      if (!layer) throw new Error('Expected an active confirmation layer')
      return within(layer).getByRole('dialog', { name: 'Confirm local example' })
    }
    await user.click(opener)
    const firstDialog = activeConfirmation()
    expect(firstDialog).toHaveAccessibleDescription('Confirm this example to update the local feedback.')
    await user.keyboard('{Escape}')
    expect(opener).toHaveFocus()
    expect(controls.queryByText('Local example confirmed.')).not.toBeInTheDocument()
    await user.click(opener)
    const dialog = activeConfirmation()
    await user.click(within(dialog).getByRole('button', { name: 'Confirm example' }))
    expect(screen.queryByRole('dialog', { name: 'Confirm local example' })).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
    expect(controls.getByText('Local example confirmed.')).toHaveAttribute('role', 'status')
  })

  it.each(['teacher', 'student'] as const)('keeps survey summaries accessible alongside retained interaction previews for %s', (role) => {
    renderGallery(role)
    const survey = within(screen.getByTestId('pattern-section-survey-results'))
    expect(survey.getByRole('group', { name: 'Group discussion: 7 responses, 35%', exact: true })).toBeInTheDocument()
    expect(survey.getByRole('group', { name: 'Other: 0 responses, 0%', exact: true })).toBeInTheDocument()
    const dialogPreview = screen.getByTestId('dialog-entry-pattern')
    expect(within(dialogPreview).getByRole('button', { name: 'Open quiet dialog entry' })).toBeInTheDocument()
    expect(screen.getByTestId('pattern-lab-contracts')).not.toContainElement(dialogPreview)
    expect(screen.getByTestId('mobile-drawer-controls')).toBeInTheDocument()
    const retainedTabs = within(screen.getByTestId('tab-entry-extension'))
    expect(retainedTabs.getByRole('tab', { name: 'Draft', selected: true })).toBeInTheDocument()
    expect(retainedTabs.getByRole('tabpanel')).toBeInTheDocument()
  })

  it.each(['teacher', 'student'] as const)('exercises ClassroomsReadRecoveryPattern first-read and retained-list recovery for %s', async (role) => {
    const user = userEvent.setup()
    renderGallery(role)
    const example = within(screen.getByTestId('pattern-section-classrooms-read-recovery'))
    expect(example.getByText(/Controlled.*fixture of the production error composition/)).toBeVisible()
    expect(example.getByRole('alert')).toHaveTextContent('Could not load classrooms')
    expect(example.getByRole('heading', { level: 1, name: 'Could not load classrooms' })).toBeVisible()
    expect(example.queryByRole('list', { name: 'Controlled retained classroom list' })).not.toBeInTheDocument()

    const retry = example.getByRole('button', { name: 'Try loading classrooms again' })
    retry.focus()
    await user.keyboard('{Enter}')
    expect(retry).toBeDisabled()
    expect(retry).toHaveAttribute('aria-busy', 'true')
    await user.click(example.getByRole('button', { name: 'Complete controlled recovery' }))
    expect(example.queryByRole('alert')).not.toBeInTheDocument()
    expect(example.getByRole('status')).toHaveTextContent('Classrooms loaded')
    expect(example.getByRole('region', { name: 'Classroom recovery example' })).toHaveFocus()

    const retainedToggle = example.getByRole('button', { name: 'Show retained-list recovery' })
    await user.click(retainedToggle)
    expect(retainedToggle).toHaveAttribute('aria-pressed', 'true')
    expect(example.getByRole('heading', { level: 2, name: 'Could not load classrooms' })).toBeVisible()
    expect(example.getByRole('alert')).toHaveClass('min-h-40')
    const retained = example.getByRole('list', { name: 'Controlled retained classroom list' })
    expect(retained).toHaveTextContent('Retained classroom — controlled fixture')
    await user.click(example.getByRole('button', { name: 'Try loading classrooms again' }))
    expect(example.getByRole('button', { name: 'Try loading classrooms again' })).toBeDisabled()
    expect(retained).toBeVisible()
    await user.click(example.getByRole('button', { name: 'Complete controlled recovery' }))
    expect(example.queryByRole('list', { name: 'Controlled retained classroom list' })).not.toBeInTheDocument()
    expect(example.queryByRole('alert')).not.toBeInTheDocument()
    await user.click(example.getByRole('button', { name: 'Show read failure' }))
    expect(retainedToggle).toHaveAttribute('aria-pressed', 'false')
    expect(example.queryByRole('list', { name: 'Controlled retained classroom list' })).not.toBeInTheDocument()
  })

  it.each(['teacher', 'student'] as const)('keeps the experimental dialog comparison outside the canonical capture for %s', (role) => {
    renderGallery(role)
    const fixture = screen.getByTestId('dialog-entry-pattern')
    expect(screen.getByTestId('pattern-lab-contracts')).not.toContainElement(fixture)
    expect(within(fixture).getByRole('button', { name: 'Open immediate dialog entry' })).toBeInTheDocument()
    expect(within(fixture).getByRole('button', { name: 'Open quiet dialog entry' })).toBeInTheDocument()
  })

  it.each(['teacher', 'student'] as const)('demonstrates normal and exam header navigation for %s', (role) => {
    renderGallery(role)
    const drawers = within(screen.getByTestId('mobile-drawer-controls'))
    expect(drawers.getByRole('heading', { name: 'Shared mobile drawer controls' })).toBeInTheDocument()
    expect(drawers.getByRole('textbox', { name: 'Drawer example draft' })).toHaveValue('Retained drawer example draft')
    if (role === 'student') expect(screen.queryByRole('button', { name: 'Open survey edit prototype' })).not.toBeInTheDocument()
    const references = within(screen.getByRole('region', { name: 'Application header references' }))
    const headers = references.getAllByRole('banner')
    expect(within(headers[0]).getByRole('heading', { name: 'Classrooms' })).toBeInTheDocument()
    expect(within(headers[0]).getByRole('button', { name: 'Enter fullscreen' })).toBeInTheDocument()
    expect(within(headers[1]).getByText('Exam header reference')).toBeInTheDocument()
    expect(within(headers[1]).getByLabelText('Exits 0')).toBeInTheDocument()
    expect(within(headers[1]).queryByRole('button', { name: 'Enter fullscreen' })).not.toBeInTheDocument()
    for (const header of headers) {
      expect(within(header).getByRole('link', { name: 'Home' })).toBeInTheDocument()
    }
  })

  beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }) })
  afterEach(() => { vi.unstubAllGlobals() })
  it('demonstrates explicitly activated formatted help', async () => {
    renderGallery()
    const controls = within(screen.getByTestId('pattern-section-controls'))
    const help = controls.getByRole('button', { name: 'Formatting help' })
    fireEvent.click(help)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Use plain text.')
    expect(help).toHaveAccessibleDescription(/Use plain text/)
    fireEvent.click(help)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

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
    expect(home.getByRole('heading', { name: 'Active classrooms' })).toHaveAttribute('tabindex', '-1')
    expect(home.getByText(/current top-right classroom actions from PR 1179/)).toBeVisible()
    expect(home.queryByRole('group', { name: 'Classroom relationship' })).not.toBeInTheDocument()
    expect(home.getByRole('region', { name: 'Joined classrooms' })).toBeVisible()
    if (role === 'teacher') expect(home.getByRole('region', { name: 'Teaching classrooms' })).toBeVisible()
    else expect(home.queryByRole('region', { name: 'Teaching classrooms' })).not.toBeInTheDocument()
    expect(home.getByRole('combobox', { name: 'Creation access' })).toBeVisible()
  })

  it.each(['teacher', 'student'] as const)('includes the student Grades visibility action for %s reviewers', (role) => {
    renderGallery(role)

    const example = within(screen.getByTestId('student-grades-pattern'))
    expect(example.getByRole('switch', { name: 'Student grades visibility' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    expect(example.getByTestId('student-grades-hidden-preview')).toBeVisible()
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
    const sectionNavigation = screen.getByRole('navigation', { name: 'Pattern Lab sections' })
    const navigator = within(sectionNavigation).getByRole('combobox', { name: 'Find a pattern' })

    await user.selectOptions(
      navigator,
      'page-mockups',
    )

    expect(window.location.hash).toBe('#page-mockups')
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    expect(within(sectionNavigation).getByRole('link', { name: 'Page mockups' })).toHaveAttribute(
      'href',
      '#page-mockups',
    )

    await user.selectOptions(
      navigator,
      'status-colors',
    )
    expect(window.location.hash).toBe('#status-colors')
    expect(scrollIntoView).toHaveBeenCalledTimes(2)

    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })
    await user.selectOptions(
      navigator,
      'mockup-settings-panel',
    )
    expect(window.location.hash).toBe('#mockup-settings-panel')
    expect(within(screen.getByTestId('page-mockups')).getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true')
    expect(within(screen.getByTestId('page-mockups')).getByRole('tabpanel', { name: 'Settings' })).toBeVisible()
    expect(scrollIntoView).toHaveBeenCalledTimes(3)
    requestAnimationFrame.mockRestore()

    fireEvent.change(navigator, { target: { value: 'survey-edit-split' } })
    expect(window.location.hash).toBe('#survey-edit-split')
    const surveyPattern = document.getElementById('survey-edit-split')!
    expect(surveyPattern).toBeInTheDocument()
    expect(within(surveyPattern).getByRole('button', { name: 'Open survey edit prototype' })).toBeVisible()
    expect(within(sectionNavigation).getByRole('link', { name: 'Survey edit' })).toHaveAttribute('href', '#survey-edit-split')
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
    const percentToggle = scoreDisplay.getByRole('button', { name: 'Show %' })
    expect(percentToggle).toHaveAttribute('aria-pressed', 'true')
    expect(percentToggle).toHaveTextContent('%')
    await user.click(percentToggle)
    const mayaRow = mockups.getByRole('row', { name: /Maya Chen/ })
    expect(within(mayaRow).getByRole('cell', { name: '18/20' })).toBeInTheDocument()
    expect(within(mayaRow).getByRole('cell', { name: '42/50' })).toBeInTheDocument()
    expect(percentToggle).toHaveAttribute('aria-pressed', 'false')
    expect(percentToggle).toHaveTextContent('%')
    await user.click(percentToggle)
    expect(percentToggle).toHaveAttribute('aria-pressed', 'true')
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

  it.each(['teacher', 'student'] as const)('keeps the example draft mounted while switching %s panels', (role) => {
    renderGallery(role)
    const draft = screen.getByRole('textbox', { name: 'Example draft' })
    fireEvent.change(draft, { target: { value: 'Unsaved example' } })
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Draft' }), { key: 'ArrowRight' })
    expect(screen.queryByRole('textbox', { name: 'Example draft' })).not.toBeInTheDocument()
    expect(document.getElementById('fluid-draft-panel')?.parentElement).toHaveAttribute('inert')
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Activity' }), { key: 'ArrowLeft' })
    expect(screen.getByRole('textbox', { name: 'Example draft' })).toBe(draft)
    expect(draft).toHaveValue('Unsaved example')
    expect(document.getElementById('fluid-draft-panel')?.parentElement).not.toHaveAttribute('inert')
  })

  it('opens and dismisses the canonical alert dialog', () => {
    renderGallery()

    fireEvent.click(within(screen.getByTestId('pattern-section-controls')).getByRole('button', { name: 'Open alert dialog' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Pattern confirmed' })
    expect(dialog).toHaveAccessibleDescription('This dialog is rendered by the canonical shared owner.')
    expect(within(dialog).getByRole('button', { name: 'Close example' })).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close example' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})
