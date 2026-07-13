import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TeacherMaterialModal } from '@/components/materials/TeacherMaterialModal'
import type { Classroom, ClassworkMaterial } from '@/types'
import { AppMessageProvider, TooltipProvider } from '@/ui'

vi.mock('@/components/editor', () => ({
  RichTextEditor: () => <div role="textbox" aria-label="Material content" />,
}))

describe('TeacherMaterialModal', () => {
  it('uses the shared classwork title and publication controls for a draft', () => {
    const classroom = {
      id: 'classroom-1',
      name: 'Test Classroom',
      archived_at: null,
    } as Classroom
    const material = {
      id: 'material-1',
      classroom_id: classroom.id,
      title: 'Course reading',
      content: { type: 'doc', content: [] },
      is_draft: true,
      released_at: null,
      position: 0,
    } as ClassworkMaterial

    render(
      <AppMessageProvider>
        <TooltipProvider>
          <TeacherMaterialModal
            classroom={classroom}
            material={material}
            isOpen
            onClose={vi.fn()}
            onSaved={vi.fn()}
          />
        </TooltipProvider>
      </AppMessageProvider>
    )

    expect(screen.getByRole('dialog')).toHaveAccessibleName('Edit Draft')
    expect(screen.getByRole('textbox', { name: /Title/ })).toHaveValue('Course reading')
    expect(screen.getByText('Saved')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Post Material' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose material action' })).toHaveAttribute('aria-haspopup', 'menu')
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })
})
