import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TeacherPatterns } from '@/app/__ui/TeacherPatterns'

describe('Pattern Lab teacher-family examples', () => {
  it('uses a fixed reference date and the shared date-description contract', () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem')
    render(<TeacherPatterns />)

    const date = screen.getByRole('button', { name: 'Go to reference today' })
    expect(date).toHaveTextContent('Fri Aug 28')
    expect(date).toHaveAccessibleDescription('2 days ago')
    fireEvent.click(screen.getByRole('button', { name: 'Previous example day' }))
    expect(date).toHaveAccessibleDescription('3 days ago')
    fireEvent.click(date)
    expect(date).toHaveAccessibleDescription('Today')
    fireEvent.click(screen.getByRole('button', { name: 'Next example day' }))
    expect(date).toHaveTextContent('Mon Aug 31')
    expect(date).not.toHaveAttribute('aria-describedby')
    expect(storage).not.toHaveBeenCalled()
    storage.mockRestore()
  })

  it('keeps the Lab display toggle temporary and removes hidden descriptions', () => {
    render(<TeacherPatterns />)
    const toggle = screen.getByRole('button', { name: 'Relative date' })
    const date = screen.getByRole('button', { name: 'Go to reference today' })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(date).not.toHaveAttribute('aria-describedby')
    expect(screen.queryByText('2 days ago')).not.toBeInTheDocument()
    fireEvent.click(toggle)
    expect(date).toHaveAccessibleDescription('2 days ago')
  })

  it('keeps both attached panels mounted and delegates keyboard selection to the mode bar', () => {
    render(<TeacherPatterns />)
    const overview = screen.getByRole('tab', { name: 'Overview' })
    const details = screen.getByRole('tab', { name: 'Work details' })
    for (const tab of [overview, details]) {
      expect(document.getElementById(tab.getAttribute('aria-controls')!)).toHaveAttribute('role', 'tabpanel')
    }
    fireEvent.keyDown(overview, { key: 'ArrowRight' })
    expect(details).toHaveFocus()
    expect(details).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: 'Work details' })).toHaveTextContent('same selected work item')
    expect(screen.queryByRole('tabpanel', { name: 'Overview' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('tabpanel', { hidden: true })).toHaveLength(2)
  })
})
