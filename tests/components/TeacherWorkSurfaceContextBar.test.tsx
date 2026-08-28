import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TeacherWorkSurfaceContextBar } from '@/components/teacher-work-surface/TeacherWorkSurfaceContextBar'

describe('TeacherWorkSurfaceContextBar', () => {
  it('keeps centered controls in flow while layering their local menus above sticky content', () => {
    render(
      <TeacherWorkSurfaceContextBar
        ariaLabel="Example controls"
        context={<span>Context</span>}
        primary={<button type="button">Primary</button>}
        actions={<button type="button">Actions</button>}
      />,
    )

    const contextBar = screen.getByRole('region', { name: 'Example controls' })
    expect(contextBar).toHaveClass('grid', 'relative', 'z-floating')
    expect(contextBar).not.toHaveClass('fixed')
    expect(screen.getByRole('button', { name: 'Primary' }).closest('.fixed')).toBeNull()
  })
})
