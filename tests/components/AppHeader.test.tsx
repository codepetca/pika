import { act, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { AppHeader } from '@/components/AppHeader'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { TooltipProvider } from '@/ui'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

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

    expect(screen.getByLabelText('Exits 2')).toHaveClass('bg-warning-bg', 'text-warning')
    expect(screen.getByText('Exit detected')).toHaveClass('sr-only')

    rerender(<AppHeader examModeHeader={{ testTitle: 'Unit Test', exitsCount: 1, awayTotalSeconds: 0 }} />)

    expect(screen.getByLabelText('Exits 1')).toHaveClass('text-text-muted')
    expect(screen.queryByText('Exit detected')).not.toBeInTheDocument()

    rerender(<AppHeader examModeHeader={{ testTitle: 'Unit Test', exitsCount: 2, awayTotalSeconds: 0 }} />)

    expect(screen.getByLabelText('Exits 2')).toHaveClass('bg-warning-bg', 'text-warning')
    expect(screen.getByText('Exit detected')).toHaveClass('sr-only')

    act(() => {
      vi.advanceTimersByTime(1600)
    })

    expect(screen.getByLabelText('Exits 2')).toHaveClass('text-text-muted')
    expect(screen.queryByText('Exit detected')).not.toBeInTheDocument()
  })
})

describe('AppHeader classroom theme', () => {
  it('themes the appbar from the current classroom color', () => {
    render(
      <AppHeader
        classrooms={[
          { id: 'class-1', title: 'Alpha', code: 'AAA111', themeColor: 'teal' },
          { id: 'class-2', title: 'Beta', code: 'BBB222', themeColor: 'rose' },
        ]}
        currentClassroomId="class-2"
      />,
      { wrapper: Wrapper }
    )

    const header = screen.getByRole('banner')

    expect(header).toHaveAttribute('data-classroom-theme-color', 'rose')
    expect(header).toHaveClass('classroom-theme-appbar')
    expect(header).not.toHaveClass('border')
    expect(header.getAttribute('style')).toContain('--classroom-accent-light')
    expect(header.getAttribute('style')).toContain('--classroom-accent-dark')
    expect(screen.getByAltText('Pika')).toHaveClass('pika-logo')
  })

  it('keeps the brand logo on unthemed appbars', () => {
    render(<AppHeader pageTitle="Classrooms" />, { wrapper: Wrapper })

    expect(screen.getByAltText('Pika')).toHaveClass('pika-logo')
    expect(screen.getByRole('link', { name: 'Home' })).toHaveClass('h-11', 'w-11')
    expect(screen.getByRole('button', { name: 'Enter fullscreen' })).toHaveClass('min-h-11', 'min-w-11')
    expect(screen.getByRole('link', { name: 'Login' })).toHaveClass('min-h-11', 'min-w-11')
  })

  it('themes the brand logo through design tokens instead of component dark utilities', () => {
    const logoSource = readFileSync(resolve(process.cwd(), 'src/components/PikaLogo.tsx'), 'utf8')
    const tokens = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8')

    expect(logoSource).toContain('pika-logo')
    expect(logoSource).not.toContain('dark:')
    expect(tokens).toContain('--pika-logo-filter: none;')
    expect(tokens).toContain('--pika-logo-filter: brightness(0) hue-rotate(15deg) invert(1) saturate(0.3) sepia(1);')
    expect(tokens).toContain('filter: var(--pika-logo-filter);')
  })

  it('keeps appbar classroom theme to the gradient without an accent underline', () => {
    const tokens = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8')
    const appbarRule = tokens.match(/\.classroom-theme-appbar \{(?<body>[\s\S]*?)\}/)?.groups?.body ?? ''

    expect(appbarRule).toContain('linear-gradient')
    expect(appbarRule).not.toContain('border-color')
    expect(appbarRule).not.toContain('border-left-color')
    expect(appbarRule).not.toContain('box-shadow')
    expect(appbarRule).not.toContain('border-bottom-color')
  })

  it('keeps classroom card theme to the gradient without accent borders', () => {
    const tokens = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8')
    const cardRule = tokens.match(/\.classroom-theme-card \{(?<body>[\s\S]*?)\}/)?.groups?.body ?? ''

    expect(cardRule).toContain('linear-gradient')
    expect(cardRule).not.toContain('border-color')
    expect(cardRule).not.toContain('border-left-color')
  })
})
