import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import { GradebookCompactPattern } from '@/app/__ui/GradebookCompactPattern'
import { AppMessageProvider, TooltipProvider } from '@/ui'

it('demonstrates independent, off-by-default zero-weight filters through the production GradebookToolbar menu', () => {
  render(<AppMessageProvider><TooltipProvider><GradebookCompactPattern /></TooltipProvider></AppMessageProvider>)
  const student = screen.getByTestId('student-grades-view')
  const open = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Gradebook more actions' }))
    return screen.getByRole('menu')
  }
  let menu = open()
  expect(within(menu).getByRole('menuitemcheckbox', { name: 'Hide 0-weight teacher' })).toHaveAttribute('aria-checked', 'false')
  expect(within(menu).getByRole('menuitemcheckbox', { name: 'Hide 0-weight student' })).toHaveAttribute('aria-checked', 'false')
  fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'Hide 0-weight teacher' }))
  expect(screen.queryByRole('button', { name: 'Edit A2: Research assignment 2', exact: true })).not.toBeInTheDocument()
  expect(within(student).getByText('Research assignment 2', { exact: true })).toBeInTheDocument()
  menu = open()
  fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'Hide 0-weight student' }))
  expect(within(student).queryByText('Research assignment 2', { exact: true })).not.toBeInTheDocument()
  menu = open()
  expect(within(menu).getByRole('menuitemcheckbox', { name: 'Hide 0-weight teacher' })).toHaveAttribute('aria-checked', 'true')
  expect(within(menu).getByRole('menuitemcheckbox', { name: 'Hide 0-weight student' })).toHaveAttribute('aria-checked', 'true')
})
