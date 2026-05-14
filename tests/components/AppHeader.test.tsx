import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { AppHeader } from '@/components/AppHeader'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { TooltipProvider } from '@/ui'

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <TooltipProvider>{children}</TooltipProvider>
    </ThemeProvider>
  )
}

describe('AppHeader exam mode', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('briefly highlights the exit count only when the exam exit count increases', () => {
    vi.useFakeTimers()

    const { rerender } = render(
      <AppHeader examModeHeader={{ testTitle: 'Unit Test', exitsCount: 1, awayTotalSeconds: 0 }} />,
      { wrapper: Wrapper }
    )

    expect(screen.getByLabelText('Exits 1')).toHaveClass('text-text-muted')
    expect(screen.queryByText('Exit detected')).not.toBeInTheDocument()

    rerender(<AppHeader examModeHeader={{ testTitle: 'Unit Test', exitsCount: 2, awayTotalSeconds: 0 }} />)

    expect(screen.getByLabelText('Exits 2')).toHaveClass('bg-warning')
    expect(screen.getByText('Exit detected')).toHaveClass('sr-only')

    rerender(<AppHeader examModeHeader={{ testTitle: 'Unit Test', exitsCount: 1, awayTotalSeconds: 0 }} />)

    expect(screen.getByLabelText('Exits 1')).toHaveClass('text-text-muted')
    expect(screen.queryByText('Exit detected')).not.toBeInTheDocument()

    rerender(<AppHeader examModeHeader={{ testTitle: 'Unit Test', exitsCount: 2, awayTotalSeconds: 0 }} />)

    expect(screen.getByLabelText('Exits 2')).toHaveClass('bg-warning')
    expect(screen.getByText('Exit detected')).toHaveClass('sr-only')

    act(() => {
      vi.advanceTimersByTime(1600)
    })

    expect(screen.getByLabelText('Exits 2')).toHaveClass('text-text-muted')
    expect(screen.queryByText('Exit detected')).not.toBeInTheDocument()
  })
})
