import { fireEvent, render, screen } from '@testing-library/react'
import { Pencil, Plus } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'
import {
  TeacherWorkSurfaceActionCluster,
  TeacherWorkSurfaceIconButton,
  TeacherWorkSurfaceMenuButton,
} from '@/components/teacher-work-surface/TeacherWorkSurfaceActionCluster'

describe('TeacherWorkSurfaceActionCluster', () => {
  it('separates primary chooser actions from direct contextual toggles', () => {
    const addAssignment = vi.fn()
    const toggleControls = vi.fn()

    render(
      <TeacherWorkSurfaceActionCluster>
        <TeacherWorkSurfaceMenuButton
          label={(
            <span>
              <Plus aria-hidden="true" />
              New Classwork
            </span>
          )}
          menuAriaLabel="New classwork"
          items={[
            {
              id: 'assignment',
              label: 'Assignment',
              onSelect: addAssignment,
            },
          ]}
        />
        <TeacherWorkSurfaceIconButton
          ariaLabel="Organize classwork"
          icon={<Pencil aria-hidden="true" />}
          pressed
          onClick={toggleControls}
        />
      </TeacherWorkSurfaceActionCluster>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'New Classwork' }))
    expect(screen.getByRole('menu', { name: 'New classwork' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Assignment' })).toBeInTheDocument()
    expect(screen.queryByText('Work students complete')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: /Assignment/ }))
    expect(addAssignment).toHaveBeenCalledTimes(1)

    expect(screen.getByRole('button', { name: 'Organize classwork' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('Reorder or delete items')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Organize classwork' }))
    expect(toggleControls).toHaveBeenCalledTimes(1)
  })

  it('supports radio-style checked menu items for mutually exclusive options', () => {
    render(
      <TeacherWorkSurfaceMenuButton
        label="Display"
        menuAriaLabel="Display options"
        items={[
          {
            id: 'percent',
            label: 'Show %',
            checked: true,
            checkedRole: 'menuitemradio',
            onSelect: vi.fn(),
          },
          {
            id: 'raw',
            label: 'Show Raw',
            checked: false,
            checkedRole: 'menuitemradio',
            onSelect: vi.fn(),
          },
          {
            id: 'columns',
            label: 'Column controls',
            checked: false,
            onSelect: vi.fn(),
          },
        ]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Display' }))

    expect(screen.getByRole('menuitemradio', { name: 'Show %' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemradio', { name: 'Show Raw' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('menuitemcheckbox', { name: 'Column controls' })).toHaveAttribute('aria-checked', 'false')
  })
})
