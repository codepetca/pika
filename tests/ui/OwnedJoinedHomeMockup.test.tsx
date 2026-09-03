import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { OwnedJoinedHomeMockup } from '@/app/__ui/OwnedJoinedHomeMockup'
import { TooltipProvider } from '@/ui'

function setup(role: 'teacher' | 'student' = 'teacher') {
  render(<TooltipProvider><OwnedJoinedHomeMockup role={role} /></TooltipProvider>)
  return { user: userEvent.setup(), home: within(screen.getByTestId('owned-joined-home-screen')) }
}

describe('OwnedJoinedHomeMockup', () => {
  it('shows both relationships and filters without changing account type', async () => {
    const { user, home } = setup()
    expect(home.getByRole('button', { name: 'Open Grade 10 Science' })).toBeVisible()
    expect(home.getByRole('button', { name: 'Open Learning Design' })).toBeVisible()
    await user.click(home.getByRole('button', { name: 'Joined', exact: true }))
    expect(home.queryByRole('button', { name: 'Open Grade 10 Science' })).not.toBeInTheDocument()
    expect(home.getByRole('button', { name: 'Joined', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await user.keyboard('{Home}')
    expect(home.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps creation eligibility independent from membership and preserves join', async () => {
    const { user, home } = setup('student')
    await user.click(home.getByRole('button', { name: 'Classroom actions' }))
    expect(screen.queryByRole('menuitem', { name: 'New Classroom' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Join classroom' })).toBeVisible()
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Edit classrooms' })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(home.getByRole('button', { name: 'Classroom actions' })).toHaveFocus()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Creation access' }), 'allowed')
    await user.click(home.getByRole('button', { name: 'Classroom actions' }))
    expect(screen.getByRole('menuitem', { name: 'New Classroom' })).toBeVisible()
  })

  it('validates the demo code and confirms the classroom before a local join', async () => {
    const { user, home } = setup('student')
    await user.click(home.getByRole('button', { name: 'Classroom actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Join classroom' }))
    await user.type(screen.getByRole('textbox', { name: 'Class code' }), 'wrong')
    await user.click(screen.getByRole('button', { name: 'Continue', exact: true }))
    expect(screen.getByRole('alert')).toHaveTextContent('Use the demo code')
    await user.clear(screen.getByRole('textbox', { name: 'Class code' }))
    await user.type(screen.getByRole('textbox', { name: 'Class code' }), ' DEMO26 ')
    await user.click(screen.getByRole('button', { name: 'Continue', exact: true }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Creative Computing')
    expect(home.queryByRole('button', { name: 'Open Creative Computing' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Join example classroom' }))
    expect(home.getByRole('button', { name: 'Open Creative Computing' })).toBeVisible()
    expect(home.getByRole('status')).toHaveTextContent('example only')
  })

  it('previews only relationship-appropriate classroom destinations', async () => {
    const { user, home } = setup()
    await user.click(home.getByRole('button', { name: 'Open Learning Design' }))
    const preview = within(screen.getByRole('dialog'))
    expect(preview.getByRole('tab', { name: 'Today' })).toBeVisible()
    expect(preview.queryByRole('tab', { name: 'Roster' })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(home.getByRole('button', { name: 'Open Learning Design' })).toHaveFocus()
    await user.click(home.getByRole('button', { name: 'Open Grade 10 Science' }))
    expect(within(screen.getByRole('dialog')).getByRole('tab', { name: 'Roster' })).toBeVisible()
  })

  it('cancels without creating and validates a local classroom before adding it', async () => {
    const { user, home } = setup()
    const openCreate = async () => {
      await user.click(home.getByRole('button', { name: 'Classroom actions' }))
      await user.click(screen.getByRole('menuitem', { name: 'New Classroom' }))
    }
    await openCreate()
    await user.type(screen.getByRole('textbox', { name: 'Classroom name' }), 'Cancelled class')
    await user.click(screen.getByRole('button', { name: 'Cancel', exact: true }))
    expect(home.queryByRole('button', { name: 'Open Cancelled class' })).not.toBeInTheDocument()
    await openCreate()
    await user.click(screen.getByRole('button', { name: 'Create example classroom' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a classroom name')
    await user.type(screen.getByRole('textbox', { name: 'Classroom name' }), 'Robotics')
    await user.click(screen.getByRole('button', { name: 'Create example classroom' }))
    expect(home.getByRole('button', { name: 'Open Robotics' })).toBeVisible()
    expect(home.getByRole('button', { name: 'Teaching', exact: true })).toHaveAttribute('aria-pressed', 'true')
    expect(home.getByRole('status')).toHaveTextContent('example only')
  })

  it('keeps a keyboard anchor when an archived row or the back action disappears', async () => {
    const { user, home } = setup()
    await user.click(home.getByRole('button', { name: 'Classroom actions' }))
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Edit classrooms' }))
    await user.click(home.getByRole('button', { name: 'Archive Grade 10 Science' }))
    await user.click(screen.getByRole('button', { name: 'Archive example' }))
    expect(home.getByRole('button', { name: 'Back to classrooms' })).toHaveFocus()
    await user.click(home.getByRole('button', { name: 'Back to classrooms' }))
    expect(home.getByRole('group', { name: 'Classroom relationship' })).toContainElement(document.activeElement as HTMLElement)
  })

  it('distinguishes loading/error/empty and recovers without network access', async () => {
    const { user, home } = setup()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Home state' }), 'error')
    expect(home.getByRole('alert')).toHaveTextContent('Classrooms couldn’t load')
    expect(home.queryByRole('button', { name: 'Open Grade 10 Science' })).not.toBeInTheDocument()
    await user.click(home.getByRole('button', { name: 'Try again' }))
    expect(home.getByRole('button', { name: 'Open Grade 10 Science' })).toBeVisible()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Account example' }), 'new')
    const emptyHome = within(screen.getByTestId('owned-joined-home-screen'))
    expect(emptyHome.getByText('No classrooms yet')).toBeVisible()
    expect(emptyHome.getByRole('button', { name: 'Join classroom', exact: true })).toBeVisible()
  })
})
