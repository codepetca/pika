import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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
  it('keeps section navigation and composite controls explicitly named', () => {
    renderGallery('student')

    expect(screen.getByRole('navigation', { name: 'Pattern Lab sections' })).toBeInTheDocument()
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
    expect(screen.getByRole('alertdialog', { name: 'Pattern confirmed' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close example' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})
