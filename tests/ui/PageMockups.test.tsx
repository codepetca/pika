import { render, screen, within } from '@testing-library/react'
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
    await user.click(within(mockups).getByRole('button', { name: 'Selected students (1)' }))
    await user.click(within(mockups).getByRole('menuitem', { name: 'Email 1 selected' }))
    expect(within(mockups).getByRole('status')).toHaveTextContent('Email students selected. Example only')
    await user.click(within(mockups).getByRole('tab', { name: 'Roster' }))
    await user.click(within(mockups).getByRole('button', { name: 'Add students' }))
    expect(within(mockups).getByRole('status')).toHaveTextContent('Add students selected. Example only')
  })

  it('uses a bottom classroom menu and Escape returns to the active non-editing list', async () => {
    const user = userEvent.setup()
    renderMockups()
    const mockups = screen.getByTestId('page-mockups')
    const classrooms = within(mockups).getByTestId('classrooms-mockup')

    await user.click(within(classrooms).getByRole('button', { name: 'Classroom actions' }))
    expect(within(classrooms).getByRole('menuitem', { name: 'Create classroom' })).toBeInTheDocument()
    await user.click(within(classrooms).getByRole('menuitemcheckbox', { name: 'Edit classrooms' }))
    expect(within(classrooms).getByText('Editing')).toBeVisible()
    expect(within(classrooms).getByRole('button', { name: 'Archive Grade 10 Science' })).toBeVisible()

    await user.click(within(classrooms).getByRole('button', { name: 'Classroom actions' }))
    await user.click(within(classrooms).getByRole('menuitemradio', { name: 'Archived' }))
    expect(within(classrooms).getByText('Archived classrooms')).toBeVisible()
    expect(within(classrooms).queryByText('Editing')).not.toBeInTheDocument()
    expect(within(classrooms).getByRole('button', { name: 'Unarchive Earth and Space Science' })).toBeVisible()

    await user.keyboard('{Escape}')
    expect(within(classrooms).getByText('Active classrooms')).toBeVisible()
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
