import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TeacherTestAuthoringDialog } from '@/components/test-workspace/TeacherTestAuthoringDialog'
import { TooltipProvider } from '@/ui'
import { createMockTest } from '../helpers/mocks'
import type { TestAssessmentWithStats } from '@/types'

vi.mock('@/components/TestDetailPanel', () => ({
  TestDetailPanel: ({ testQuestionLayout }: { testQuestionLayout?: string }) => (
    <div data-testid="test-authoring-detail" data-question-layout={testQuestionLayout} />
  ),
}))

const test = {
  ...createMockTest({
    id: 'test-1',
    title: 'Unit Test',
    assessment_type: 'test',
  }),
  assessment_type: 'test',
  stats: {
    total_students: 10,
    responded: 5,
    submitted: 3,
    open_access: 2,
    closed_access: 8,
    questions_count: 4,
  },
} as TestAssessmentWithStats

function renderDialog({
  hasPendingMarkdownImport = false,
  onRequestPreview = vi.fn(),
}: {
  hasPendingMarkdownImport?: boolean
  onRequestPreview?: (preview: { testId: string; title: string }) => void
} = {}) {
  render(
    <TooltipProvider>
      <TeacherTestAuthoringDialog
        isOpen
        test={test}
        classroomId="classroom-1"
        apiBasePath="/api/teacher/tests"
        hasPendingMarkdownImport={hasPendingMarkdownImport}
        onClose={vi.fn()}
        onDraftSummaryChange={vi.fn()}
        onTestUpdate={vi.fn()}
        onPendingMarkdownImportChange={vi.fn()}
        onRequestPreview={onRequestPreview}
      />
    </TooltipProvider>,
  )

  return { onRequestPreview }
}

describe('TeacherTestAuthoringDialog', () => {
  it('names the authoring surface and exposes visual and markdown editor modes', () => {
    const { onRequestPreview } = renderDialog()
    const dialog = screen.getByRole('dialog', { name: 'Edit test' })
    const codeButton = within(dialog).getByRole('button', { name: 'Code' })

    expect(within(dialog).getByText('Edit test')).toBeVisible()
    expect(screen.getByTestId('test-authoring-detail')).toHaveAttribute(
      'data-question-layout',
      'editor-only',
    )
    expect(codeButton).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(codeButton)

    expect(screen.getByTestId('test-authoring-detail')).toHaveAttribute(
      'data-question-layout',
      'markdown-only',
    )
    expect(codeButton).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Preview' }))
    expect(onRequestPreview).toHaveBeenCalledWith({
      testId: 'test-1',
      title: 'Unit Test',
    })
  })

  it('locks preview while markdown changes are pending', () => {
    renderDialog({ hasPendingMarkdownImport: true })

    expect(
      within(screen.getByRole('dialog', { name: 'Edit test' })).getByRole('button', {
        name: 'Preview',
      }),
    ).toBeDisabled()
  })
})
