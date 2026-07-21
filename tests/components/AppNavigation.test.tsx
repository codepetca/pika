import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppNavigation } from '@/components/AppNavigation'

let pathname = '/teacher/blueprints'

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
}))

const items = [
  { href: '/classrooms', label: 'Classrooms' },
  { href: '/teacher/blueprints', label: 'Blueprints', match: 'prefix' as const },
  { href: '/teacher/calendar', label: 'Calendar', match: 'prefix' as const },
]

describe('AppNavigation', () => {
  beforeEach(() => {
    pathname = '/teacher/blueprints'
  })

  it('names the route family and marks only the matching destination as current', () => {
    render(<AppNavigation label="Teacher tools" items={items} />)

    expect(screen.getByRole('navigation', { name: 'Teacher tools' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Blueprints' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Classrooms' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: 'Calendar' })).not.toHaveAttribute('aria-current')
  })

  it('keeps nested utility routes active without treating partial sibling names as matches', () => {
    pathname = '/teacher/blueprints/import'
    const { rerender } = render(<AppNavigation label="Teacher tools" items={items} />)

    expect(screen.getByRole('link', { name: 'Blueprints' })).toHaveAttribute('aria-current', 'page')

    pathname = '/teacher/blueprints-old'
    rerender(<AppNavigation label="Teacher tools" items={items} />)

    expect(screen.queryByRole('link', { current: 'page' })).not.toBeInTheDocument()
  })

  it('provides stable narrow-width overflow, target sizing, and keyboard focus treatment', () => {
    render(<AppNavigation label="Teacher tools" items={items} />)

    const scrollRegion = screen.getByRole('navigation', { name: 'Teacher tools' })
      .querySelector('[data-app-navigation-scroll]')
    const classrooms = screen.getByRole('link', { name: 'Classrooms' })

    expect(scrollRegion).toHaveClass('overflow-x-auto', 'min-h-11')
    expect(classrooms).toHaveClass('min-h-11', 'focus-visible:ring-2')

    classrooms.focus()
    expect(classrooms).toHaveFocus()
  })
})
