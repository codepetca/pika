import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import { GradebookCompactPattern } from '@/app/__ui/GradebookCompactPattern'
import { AppMessageProvider, TooltipProvider } from '@/ui'

it('demonstrates the default-on shared compact setting through GradebookToolbar, GradebookTable and StudentGradesView', () => {
  render(<AppMessageProvider><TooltipProvider><GradebookCompactPattern /></TooltipProvider></AppMessageProvider>)
  const student = screen.getByTestId('student-grades-view')
  expect(within(student).queryByText('Unit test 1', { exact: true })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Edit Avery Chen mark for Unit test 1:.*not returned to student/ })).toBeInTheDocument()
  const header = screen.getByRole('button', { name: 'Edit A2: Research assignment 2', exact: true }).closest('th')!
  const title = within(student).getByText('Research assignment 2', { exact: true })
  const grade = within(student).getByText('Current grade').parentElement!.nextElementSibling!.textContent
  const open = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Gradebook more actions' }))
    return screen.getByRole('menu')
  }
  expect(header).toHaveAttribute('data-compact-zero-weight', 'true')
  expect(header).toHaveTextContent('A2')
  expect(title).toHaveClass('text-text-muted')
  let menu = open()
  expect(within(menu).getByRole('menuitemcheckbox', { name: 'Compact 0-weight assessments' })).toHaveAttribute('aria-checked', 'true')
  expect(within(menu).queryByText(/Hide 0-weight/)).not.toBeInTheDocument()
  fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'Compact 0-weight assessments' }))
  expect(header).not.toHaveAttribute('data-compact-zero-weight')
  expect(header).toHaveTextContent('Research assignment 2')
  expect(title).toHaveClass('text-text-default')
  expect(within(student).getByText('Current grade').parentElement!.nextElementSibling!.textContent).toBe(grade)
  menu = open()
  expect(within(menu).getByRole('menuitemcheckbox', { name: 'Compact 0-weight assessments' })).toHaveAttribute('aria-checked', 'false')
})
