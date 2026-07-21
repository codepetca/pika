import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppShell } from '@/components/AppShell'

vi.mock('@/components/AppHeader', () => ({
  AppHeader: () => <header>Header</header>,
}))

vi.mock('@/components/AuthSessionWatcher', () => ({
  AuthSessionWatcher: () => null,
}))

describe('AppShell', () => {
  it('keeps the main content region full width with default and custom page classes', () => {
    const { rerender } = render(<AppShell>Default content</AppShell>)

    expect(screen.getByRole('main')).toHaveClass('w-full', 'max-w-7xl')

    rerender(<AppShell mainClassName="max-w-none px-0 py-0">Custom content</AppShell>)
    expect(screen.getByRole('main')).toHaveClass('w-full', 'max-w-none', 'px-0', 'py-0')
  })

  it('places optional application navigation between the header and main content', () => {
    render(
      <AppShell navigation={<nav aria-label="Teacher tools">Navigation</nav>}>
        Content
      </AppShell>,
    )

    const header = screen.getByRole('banner')
    const navigation = screen.getByRole('navigation', { name: 'Teacher tools' })
    const main = screen.getByRole('main')

    expect(header.compareDocumentPosition(navigation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(navigation.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
