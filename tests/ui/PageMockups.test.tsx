import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { PageMockups } from '@/app/__ui/PageMockups'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { TooltipProvider } from '@/ui'

function renderMockups() {
  return render(<ThemeProvider><TooltipProvider><PageMockups /></TooltipProvider></ThemeProvider>)
}

describe('PageMockups', () => {
  it('keeps every named tab target mounted and supports keyboard tab changes', async () => {
    const user = userEvent.setup()
    renderMockups()
    const mockups = screen.getByTestId('page-mockups')
    for (const name of ['Classrooms', 'Gradebook', 'Calendar', 'Announcements', 'Roster', 'Settings', 'Workspaces']) {
      const tab = within(mockups).getByRole('tab', { name })
      expect(document.getElementById(tab.getAttribute('aria-controls')!)).toBeInTheDocument()
    }
    const classrooms = within(mockups).getByRole('tab', { name: 'Classrooms' })
    classrooms.focus()
    await user.keyboard('{ArrowRight}')
    expect(within(mockups).getByRole('tab', { name: 'Gradebook' })).toHaveAttribute('aria-selected', 'true')
    expect(within(mockups).getByRole('tabpanel', { name: 'Gradebook' })).toBeVisible()
  })

  it('retries local error state and explains prototype-only actions', async () => {
    const user = userEvent.setup()
    renderMockups()
    const mockups = screen.getByTestId('page-mockups')
    await user.click(within(mockups).getByRole('tab', { name: 'Gradebook' }))
    await user.selectOptions(within(mockups).getByRole('combobox', { name: 'Example state' }), 'error')
    await user.click(within(mockups).getByRole('button', { name: 'Try loading gradebook again' }))
    expect(within(mockups).getByRole('table')).toBeInTheDocument()
    await user.click(within(mockups).getByRole('checkbox', { name: 'Select Maya Chen' }))
    await user.click(within(mockups).getByRole('button', { name: '1 selected' }))
    await user.click(within(mockups).getByRole('menuitem', { name: 'Email selected students' }))
    expect(within(mockups).getByRole('status')).toHaveTextContent('Email students selected. Example only')
    await user.click(within(mockups).getByRole('tab', { name: 'Roster' }))
    await user.click(within(mockups).getByRole('button', { name: 'Add students' }))
    expect(within(mockups).getByRole('status')).toHaveTextContent('Add students selected. Example only')
  })

  it('keeps compact identity columns and lets Assessments fill the empty table', async () => {
    const user = userEvent.setup()
    renderMockups()
    const mockups = screen.getByTestId('page-mockups')
    await user.click(within(mockups).getByRole('tab', { name: 'Gradebook' }))
    await user.selectOptions(within(mockups).getByRole('combobox', { name: 'Example state' }), 'empty')

    const gradebook = within(mockups).getByRole('tabpanel', { name: 'Gradebook' })
    const table = within(gradebook).getByRole('table')
    expect(within(gradebook).getByRole('columnheader', { name: 'First' })).toHaveStyle({ width: '96px' })
    expect(within(gradebook).getByRole('columnheader', { name: 'Last' })).toHaveStyle({ width: '96px' })
    expect(within(gradebook).getByRole('columnheader', { name: 'Assessments' })).toBeInTheDocument()
    expect(within(gradebook).getByRole('columnheader', { name: 'Final' })).toBeInTheDocument()
    expect(within(gradebook).queryByRole('columnheader', { name: 'Ecosystems' })).not.toBeInTheDocument()
    expect(within(gradebook).queryByRole('columnheader', { name: 'Cells' })).not.toBeInTheDocument()
    expect(table.querySelectorAll('col')).toHaveLength(5)
    expect(table.parentElement).toHaveClass('w-full')
    expect(table.parentElement).toHaveStyle({ minWidth: '408px' })
    expect(table.querySelectorAll('col')[0]).toHaveStyle({ width: '40px' })
    expect(table.querySelectorAll('col')[3]).not.toHaveAttribute('style')
    expect(table.querySelectorAll('col')[4]).toHaveStyle({ width: '80px' })

    const firstResizeHandle = within(gradebook).getByRole('separator', { name: 'Resize First column' })
    firstResizeHandle.focus()
    await user.keyboard('{ArrowRight}')
    expect(within(gradebook).getByRole('columnheader', { name: 'First' })).toHaveStyle({ width: '104px' })

    const lastResizeHandle = within(gradebook).getByRole('separator', { name: 'Resize Last column' })
    lastResizeHandle.focus()
    await user.keyboard('{Home}')
    expect(within(gradebook).getByRole('columnheader', { name: 'Last' })).toHaveStyle({ width: '72px' })
    const longLastName = within(gradebook).getByRole('cell', { name: 'Williams-Montgomery' })
    expect(longLastName).toHaveClass('truncate', 'whitespace-nowrap')
    expect(longLastName).toHaveAttribute('title', 'Williams-Montgomery')

    const mayaRow = within(gradebook).getByRole('row', { name: /Maya Chen/ })
    expect(within(mayaRow).getByRole('cell', { name: 'No assessments' })).toBeEmptyDOMElement()
    expect(within(mayaRow).getByRole('cell', { name: '—' })).toBeInTheDocument()
  })

  it('keeps each assessment at minimum width in the few-assessments state', async () => {
    const user = userEvent.setup()
    renderMockups()
    const mockups = screen.getByTestId('page-mockups')
    await user.click(within(mockups).getByRole('tab', { name: 'Gradebook' }))
    await user.selectOptions(within(mockups).getByRole('combobox', { name: 'Example state' }), 'few-assessments')

    const gradebook = within(mockups).getByRole('tabpanel', { name: 'Gradebook' })
    const table = within(gradebook).getByRole('table')
    expect(table.querySelectorAll('col')).toHaveLength(8)
    expect(table.parentElement).toHaveClass('w-full')
    expect(table.parentElement).toHaveStyle({ minWidth: '672px' })
    for (const columnIndex of [3, 4, 5]) {
      expect(table.querySelectorAll('col')[columnIndex]).toHaveStyle({ width: '88px' })
    }
    expect(table.querySelectorAll('col')[6]).not.toHaveAttribute('style')
    expect(table.querySelectorAll('col')[7]).toHaveStyle({ width: '80px' })
    for (const assessment of ['Ecosystems', 'Cells', 'Genetics']) {
      expect(within(gradebook).getByRole('columnheader', { name: assessment })).toBeInTheDocument()
    }
    expect(within(gradebook).queryByRole('columnheader', { name: 'Reactions' })).not.toBeInTheDocument()
    expect(within(gradebook).getByRole('columnheader', { name: 'Unused assessment space' })).toBeInTheDocument()
    expect(within(gradebook).getByText(/empty assessment area expands and keeps Final at the far edge/)).toBeInTheDocument()
  })

  it('demonstrates gradebook category and assessment editing dialogs', async () => {
    const user = userEvent.setup()
    renderMockups()
    const mockups = screen.getByTestId('page-mockups')
    await user.click(within(mockups).getByRole('tab', { name: 'Gradebook' }))
    const gradebook = within(mockups).getByRole('tabpanel', { name: 'Gradebook' })

    const moreActions = within(gradebook).getByRole('button', { name: 'More actions' })
    await user.click(moreActions)
    await user.click(screen.getByRole('menuitem', { name: 'Edit gradebook' }))
    expect(screen.getByRole('heading', { name: 'Edit gradebook' })).toBeInTheDocument()
    expect(screen.getAllByRole('textbox', { name: 'Category name' })[1]).toHaveValue('Term')
    expect(screen.getByRole('button', { name: 'Default' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Move Term up' }))
    expect(screen.getAllByRole('textbox', { name: 'Category name' })[0]).toHaveValue('Term')
    await user.click(screen.getByRole('button', { name: 'Save gradebook' }))

    await user.click(within(gradebook).getByRole('button', { name: 'More actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Edit gradebook' }))
    expect(screen.getAllByRole('textbox', { name: 'Category name' })[0]).toHaveValue('Term')
    await user.keyboard('{Escape}')
    expect(moreActions).toHaveFocus()

    const assessmentTitle = within(gradebook).getByRole('button', { name: 'Ecosystems' })
    await user.click(assessmentTitle)
    expect(screen.getByRole('heading', { name: 'Ecosystems' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Category' })).toHaveDisplayValue('Term')
    expect(screen.getByText('65%')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(assessmentTitle).toHaveFocus()
  })

  it('moves fixture assessments to Uncategorized when their category is deleted', async () => {
    const user = userEvent.setup()
    renderMockups()
    const mockups = screen.getByTestId('page-mockups')
    await user.click(within(mockups).getByRole('tab', { name: 'Gradebook' }))
    const gradebook = within(mockups).getByRole('tabpanel', { name: 'Gradebook' })

    await user.click(within(gradebook).getByRole('button', { name: 'More actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Edit gradebook' }))
    expect(screen.getByText('Deleting a category leaves its assessments Uncategorized.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete Term' }))
    const percentages = screen.getAllByRole('spinbutton', { name: 'Course %' })
    await user.clear(percentages[0])
    await user.type(percentages[0], '75')
    await user.click(screen.getByRole('button', { name: 'Save gradebook' }))

    await user.click(within(gradebook).getByRole('button', { name: 'Ecosystems' }))
    expect(screen.getByRole('combobox', { name: 'Category' })).toHaveDisplayValue('Uncategorized')
  })

  it('pins one class summary row and swaps average with median from More actions', async () => {
    const user = userEvent.setup()
    renderMockups()
    const mockups = screen.getByTestId('page-mockups')
    await user.click(within(mockups).getByRole('tab', { name: 'Gradebook' }))
    const gradebook = within(mockups).getByRole('tabpanel', { name: 'Gradebook' })
    const scrollFrame = within(gradebook).getByTestId('gradebook-scroll-frame')
    const summaryFooter = within(gradebook).getByTestId('gradebook-summary-footer')

    expect(scrollFrame).toHaveClass('h-80', 'overflow-auto')
    expect(summaryFooter).toHaveClass('sticky', 'bottom-0', 'bg-surface-2')
    const averageRow = within(summaryFooter).getByRole('row', { name: 'Class average' })
    expect(within(averageRow).getAllByRole('cell')[3]).toHaveTextContent('85%')
    expect(within(summaryFooter).queryByRole('row', { name: 'Class median' })).not.toBeInTheDocument()
    expect(within(gradebook).getByText(/roster rows scroll underneath/)).toBeInTheDocument()

    await user.click(within(gradebook).getByRole('button', { name: 'More actions' }))
    await user.click(within(gradebook).getByRole('menuitem', { name: 'Show median' }))
    const medianRow = within(summaryFooter).getByRole('row', { name: 'Class median' })
    expect(within(medianRow).getAllByRole('cell')[3]).toHaveTextContent('90%')
    expect(within(summaryFooter).queryByRole('row', { name: 'Class average' })).not.toBeInTheDocument()

    await user.click(within(gradebook).getByRole('button', { name: 'More actions' }))
    await user.click(within(gradebook).getByRole('menuitem', { name: 'Show average' }))
    await user.click(within(gradebook).getByRole('button', { name: 'More actions' }))
    await user.click(within(gradebook).getByRole('menuitem', { name: 'Show raw scores' }))
    expect(within(summaryFooter).getByRole('row', { name: 'Class average' }).querySelectorAll('td')[3]).toHaveTextContent('17/20')

    await user.selectOptions(within(mockups).getByRole('combobox', { name: 'Example state' }), 'empty')
    expect(within(gradebook).queryByTestId('gradebook-summary-footer')).not.toBeInTheDocument()
  })

  it('swaps First and Last while keeping the leading name column pinnable', async () => {
    const user = userEvent.setup()
    renderMockups()
    const mockups = screen.getByTestId('page-mockups')
    await user.click(within(mockups).getByRole('tab', { name: 'Gradebook' }))
    const gradebook = within(mockups).getByRole('tabpanel', { name: 'Gradebook' })

    expect(within(gradebook).getByRole('columnheader', { name: 'First' })).toHaveProperty('cellIndex', 1)
    expect(within(gradebook).getByRole('columnheader', { name: 'Last' })).toHaveProperty('cellIndex', 2)
    await user.click(within(gradebook).getByRole('button', { name: 'More actions' }))
    await user.click(within(gradebook).getByRole('menuitem', { name: 'Show last name first' }))
    expect(within(gradebook).getByRole('columnheader', { name: 'Last' })).toHaveProperty('cellIndex', 1)
    expect(within(gradebook).getByRole('columnheader', { name: 'First' })).toHaveProperty('cellIndex', 2)

    await user.click(within(gradebook).getByRole('button', { name: 'More actions' }))
    expect(within(gradebook).getByRole('menuitem', { name: 'Show first name first' })).toBeInTheDocument()
    expect(within(gradebook).getByRole('menuitemcheckbox', { name: 'Keep key columns visible' })).toHaveAttribute('aria-checked', 'true')
    await user.keyboard('{Escape}')
    expect(within(gradebook).getByRole('columnheader', { name: 'Last' })).toHaveClass('sticky', 'left-10', 'top-0')
    expect(within(gradebook).getByRole('columnheader', { name: 'First' })).not.toHaveClass('sticky')
    expect(within(gradebook).getByRole('cell', { name: 'Chen', exact: true })).toHaveClass('sticky', 'left-10')
    expect(within(gradebook).getByRole('cell', { name: 'Maya', exact: true })).not.toHaveClass('sticky')

    await user.click(within(gradebook).getByRole('button', { name: 'More actions' }))
    await user.click(within(gradebook).getByRole('menuitem', { name: 'Show first name first' }))
    expect(within(gradebook).getByRole('columnheader', { name: 'First' })).toHaveProperty('cellIndex', 1)
  })

  it('keeps selection, First, and Final visible when key columns are frozen', async () => {
    const user = userEvent.setup()
    renderMockups()
    const mockups = screen.getByTestId('page-mockups')
    await user.click(within(mockups).getByRole('tab', { name: 'Gradebook' }))
    const gradebook = within(mockups).getByRole('tabpanel', { name: 'Gradebook' })

    await user.click(within(gradebook).getByRole('button', { name: 'More actions' }))
    const keepVisible = within(gradebook).getByRole('menuitemcheckbox', { name: 'Keep key columns visible' })
    expect(keepVisible).toHaveAttribute('aria-checked', 'true')
    await user.keyboard('{Escape}')

    expect(within(gradebook).getByRole('checkbox', { name: 'Select all gradebook students' }).closest('th')).toHaveClass('sticky', 'left-0')
    expect(within(gradebook).getByRole('columnheader', { name: 'First' })).toHaveClass('sticky', 'left-10', 'top-0')
    expect(within(gradebook).getByRole('columnheader', { name: 'Final' })).toHaveClass('sticky', 'right-0')
    expect(within(gradebook).getByRole('checkbox', { name: 'Select Maya Chen' }).closest('td')).toHaveClass('sticky', 'left-0')
    expect(within(gradebook).getByRole('cell', { name: 'Maya', exact: true })).toHaveClass('sticky', 'left-10')

    await user.click(within(gradebook).getByRole('button', { name: 'More actions' }))
    expect(within(gradebook).getByRole('menuitemcheckbox', { name: 'Keep key columns visible' })).toHaveAttribute('aria-checked', 'true')
  })

  it('uses a bottom classroom menu and Escape returns to the active non-editing list', async () => {
    const user = userEvent.setup()
    renderMockups()
    const mockups = screen.getByTestId('page-mockups')
    const classrooms = within(mockups).getByTestId('classrooms-mockup')

    await user.click(within(classrooms).getByRole('button', { name: 'Classroom actions' }))
    expect(within(classrooms).getByRole('menuitem', { name: 'New Classroom' })).toBeInTheDocument()
    await user.click(within(classrooms).getByRole('menuitemcheckbox', { name: 'Edit classrooms' }))
    expect(within(classrooms).getByText('Editing')).toBeVisible()
    expect(within(classrooms).getByRole('button', { name: 'Back to classrooms' })).toBeVisible()
    expect(within(classrooms).getByRole('button', { name: 'Archive Grade 10 Science' })).toBeVisible()

    await user.click(within(mockups).getByRole('tab', { name: 'Gradebook' }))
    await user.keyboard('{Escape}')
    await user.click(within(mockups).getByRole('tab', { name: 'Classrooms' }))
    expect(within(classrooms).getByText('Editing')).toBeVisible()

    const exampleState = within(mockups).getByRole('combobox', { name: 'Example state' })
    exampleState.focus()
    await user.keyboard('{Escape}')
    expect(exampleState).toHaveFocus()
    expect(within(classrooms).getByText('Editing')).toBeVisible()

    await user.click(within(classrooms).getByRole('button', { name: 'Classroom actions' }))
    await user.click(within(classrooms).getByRole('menuitem', { name: 'Show Archived' }))
    expect(within(classrooms).getByText('Archived classrooms')).toBeVisible()
    expect(within(classrooms).queryByText('Editing')).not.toBeInTheDocument()
    expect(within(classrooms).getByRole('button', { name: 'Unarchive Earth and Space Science' })).toBeVisible()
    await user.click(within(classrooms).getByRole('button', { name: 'Back to classrooms' }))
    const activeHeading = within(classrooms).getByRole('heading', { name: 'Active classrooms' })
    expect(activeHeading).toBeVisible()
    await waitFor(() => expect(activeHeading).toHaveFocus())

    await user.click(within(classrooms).getByRole('button', { name: 'Classroom actions' }))
    await user.click(within(classrooms).getByRole('menuitem', { name: 'Show Archived' }))
    await user.click(within(classrooms).getByRole('button', { name: 'Classroom actions' }))
    await user.click(within(classrooms).getByRole('menuitem', { name: 'Show Active' }))
    expect(within(classrooms).getByText('Active classrooms')).toBeVisible()

    await user.click(within(classrooms).getByRole('button', { name: 'Classroom actions' }))
    await user.click(within(classrooms).getByRole('menuitem', { name: 'Show Archived' }))

    await user.keyboard('{Escape}')
    await waitFor(() => expect(within(classrooms).getByRole('heading', { name: 'Active classrooms' })).toHaveFocus())
    expect(within(classrooms).queryByText('Editing')).not.toBeInTheDocument()
    expect(within(classrooms).queryByRole('button', { name: 'Archive Grade 10 Science' })).not.toBeInTheDocument()
  })

  it('offers Week, Month, and Term as the Calendar view choices', async () => {
    const user = userEvent.setup()
    renderMockups()
    const mockups = screen.getByTestId('page-mockups')
    await user.click(within(mockups).getByRole('tab', { name: 'Calendar' }))
    const calendar = within(mockups).getByRole('tabpanel', { name: 'Calendar' })
    await user.click(within(calendar).getByRole('button', { name: 'More actions' }))

    expect(within(calendar).getByRole('menuitemradio', { name: 'Week' })).toBeInTheDocument()
    expect(within(calendar).getByRole('menuitemradio', { name: 'Month' })).toBeInTheDocument()
    expect(within(calendar).getByRole('menuitemradio', { name: 'Term' })).toBeInTheDocument()
    expect(within(calendar).queryByRole('menuitemradio', { name: 'All' })).not.toBeInTheDocument()
    expect(within(calendar).queryByRole('menuitemradio', { name: 'Year' })).not.toBeInTheDocument()
    await user.click(within(calendar).getByRole('menuitemradio', { name: 'Term' }))
    expect(within(calendar).getByText('Semester 1')).toBeVisible()
    expect(within(calendar).queryByRole('button', { name: /Return to reference/ })).not.toBeInTheDocument()
    expect(within(calendar).getByText('January', { exact: true })).toBeVisible()
    expect(within(calendar).getByText('Semester ecosystem reflection.')).toBeInTheDocument()
  })

  it('exercises SettingsMockup section semantics, inline save feedback, and guarded access changes', async () => {
    const user = userEvent.setup()
    renderMockups()
    const mockups = screen.getByTestId('page-mockups')
    await user.click(within(mockups).getByRole('tab', { name: 'Settings' }))
    const settings = within(mockups).getByTestId('settings-mockup')

    const classroomName = within(settings).getByRole('textbox', { name: 'Classroom name' })
    await user.clear(classroomName)
    await user.type(classroomName, 'Biology 10')
    expect(within(settings).getByRole('status')).toHaveTextContent('Unsaved')
    await user.tab()
    expect(within(settings).getByRole('status')).toHaveTextContent('Saved')

    const blue = within(settings).getByRole('button', { name: 'Blue Selected' })
    const green = within(settings).getByRole('button', { name: 'Green' })
    expect(blue).toHaveAttribute('aria-pressed', 'true')
    await user.click(green)
    expect(green).toHaveAttribute('aria-pressed', 'true')
    expect(blue).toHaveAttribute('aria-pressed', 'false')
    expect(within(settings).getByRole('button', { name: 'Green Selected' })).toBeVisible()

    await user.click(within(settings).getByRole('button', { name: 'Access' }))
    await user.click(within(settings).getByRole('button', { name: 'Generate new join code and link' }))
    const dialog = screen.getByRole('dialog', { name: 'Generate new join code and link?' })
    expect(dialog).toHaveTextContent('current code and link will stop working')
    await user.click(within(dialog).getByRole('button', { name: 'Generate' }))
    expect(within(settings).getByRole('button', { name: 'Copy join code' })).toHaveTextContent('PL9K2A')
  })

  it('exercises WorkSurfaceMockup from a full-width list through its active inspector', async () => {
    const user = userEvent.setup()
    renderMockups()
    const mockups = screen.getByTestId('page-mockups')
    await user.click(within(mockups).getByRole('tab', { name: 'Workspaces' }))
    const workspace = within(mockups).getByTestId('work-surface-mockup')

    expect(within(workspace).queryByText('Student work')).not.toBeInTheDocument()
    expect(within(workspace).getByRole('button', { name: 'Create classwork' })).toBeVisible()
    expect(within(workspace).queryByRole('button', { name: 'Organize classwork' })).not.toBeInTheDocument()
    await user.click(within(workspace).getByRole('button', { name: 'More actions' }))
    expect(within(workspace).getByRole('menuitem', { name: 'Organize classwork' })).toBeVisible()
    await user.keyboard('{Escape}')

    await user.click(within(workspace).getByRole('button', { name: 'Tests' }))
    expect(within(workspace).getByRole('button', { name: 'Create test' })).toBeVisible()
    expect(within(workspace).queryByRole('button', { name: 'Organize tests' })).not.toBeInTheDocument()
    await user.click(within(workspace).getByRole('button', { name: 'More actions' }))
    expect(within(workspace).getByRole('menuitem', { name: 'Organize tests' })).toBeVisible()
    await user.keyboard('{Escape}')

    await user.click(within(workspace).getByRole('button', { name: 'Classwork' }))
    await user.click(within(workspace).getByRole('button', { name: /^Field observations/ }))
    expect(within(workspace).getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
    expect(document.getElementById('work-pattern-students-panel')).toBeInTheDocument()

    await user.click(within(workspace).getByRole('tab', { name: 'Students' }))
    await user.click(within(workspace).getByRole('checkbox', { name: 'Select Maya Chen' }))
    expect(within(workspace).getByRole('button', { name: 'Selected students (1)' })).toBeEnabled()
    await user.click(within(workspace).getByRole('button', { name: 'Maya Chen' }))
    expect(within(workspace).getByText('Student work')).toBeVisible()
    const divider = within(workspace).getByRole('separator', { name: 'Resize student list and work preview' })
    expect(divider).toBeInTheDocument()
    divider.focus()
    await user.keyboard('{ArrowLeft}')
    expect(divider).toHaveAttribute('aria-valuenow', '45')

    await user.click(within(workspace).getByRole('button', { name: 'Back to item list' }))
    expect(within(workspace).queryByRole('tab', { name: 'Students' })).not.toBeInTheDocument()
    expect(within(workspace).getByRole('button', { name: /^Field observations/ })).toBeVisible()
  })
})
