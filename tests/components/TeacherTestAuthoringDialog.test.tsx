import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TeacherTestAuthoringDialog } from '@/components/test-workspace/TeacherTestAuthoringDialog'
import { TooltipProvider } from '@/ui'
import { createMockTest } from '../helpers/mocks'
import type { TestAssessmentWithStats } from '@/types'

const draftFlush = vi.hoisted(() => vi.fn(async () => true))

vi.mock('@/components/TestDetailPanel', () => ({
  TestDetailPanel: ({
    testQuestionLayout,
    onDraftFlushReady,
  }: {
    testQuestionLayout?: string
    onDraftFlushReady?: (flush: (() => Promise<boolean>) | null) => void
  }) => {
    onDraftFlushReady?.(draftFlush)
    return <div data-testid="test-authoring-detail" data-question-layout={testQuestionLayout} />
  },
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
  onRequestPublish = vi.fn(async () => true),
  onClose = vi.fn(),
  testOverride = test,
}: {
  hasPendingMarkdownImport?: boolean
  onRequestPreview?: (preview: { testId: string; title: string }) => void
  onRequestPublish?: () => Promise<boolean>
  onClose?: () => void
  testOverride?: TestAssessmentWithStats
} = {}) {
  render(
    <TooltipProvider>
      <TeacherTestAuthoringDialog
        isOpen
        test={testOverride}
        classroomId="classroom-1"
        apiBasePath="/api/teacher/tests"
        hasPendingMarkdownImport={hasPendingMarkdownImport}
        onClose={onClose}
        onDraftSummaryChange={vi.fn()}
        onTestUpdate={vi.fn()}
        onPendingMarkdownImportChange={vi.fn()}
        onRequestPreview={onRequestPreview}
        onRequestPublish={onRequestPublish}
      />
    </TooltipProvider>,
  )

  return { onClose, onRequestPreview, onRequestPublish }
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

  it('publishes only from draft authoring after flushing the latest save', async () => {
    draftFlush.mockClear()
    const onRequestPublish = vi.fn(async () => true)
    renderDialog({
      onRequestPublish,
      testOverride: { ...test, status: 'draft' },
    })

    fireEvent.click(within(screen.getByRole('dialog', { name: 'Edit test' })).getByRole('button', {
      name: 'Publish',
    }))

    await waitFor(() => expect(draftFlush).toHaveBeenCalledTimes(1))
    expect(onRequestPublish).toHaveBeenCalledTimes(1)
  })

  it('does not show publication controls after the test is published', () => {
    renderDialog({ testOverride: { ...test, status: 'closed' } })

    expect(
      within(screen.getByRole('dialog', { name: 'Edit test' })).queryByRole('button', {
        name: 'Publish',
      }),
    ).not.toBeInTheDocument()
  })

  it('waits for the latest draft save before closing', async () => {
    draftFlush.mockClear()
    let resolveFlush: ((saved: boolean) => void) | null = null
    draftFlush.mockImplementationOnce(() => new Promise<boolean>((resolve) => {
      resolveFlush = resolve
    }))
    const onClose = vi.fn()
    renderDialog({ onClose })
    const dialog = screen.getByRole('dialog', { name: 'Edit test' })

    fireEvent.click(within(dialog).getByRole('button', {
      name: 'Close',
    }))

    await waitFor(() => expect(draftFlush).toHaveBeenCalledTimes(1))
    expect(within(dialog).getByRole('button', { name: 'Saving...' })).toBeDisabled()
    expect(onClose).not.toHaveBeenCalled()

    await act(async () => {
      resolveFlush?.(true)
    })

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
