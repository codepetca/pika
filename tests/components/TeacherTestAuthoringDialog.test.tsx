import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TeacherTestAuthoringDialog } from '@/components/test-workspace/TeacherTestAuthoringDialog'
import { TooltipProvider } from '@/ui'
import { createMockTest } from '../helpers/mocks'
import type { TestAssessmentWithStats } from '@/types'

const draftFlush = vi.hoisted(() => vi.fn(async () => true))
const draftPristineCheck = vi.hoisted(() => vi.fn(() => ({
  isPristine: false,
  draftVersion: 1,
  testUpdatedAt: '2024-10-10T10:00:00Z',
})))

vi.mock('@/components/TestDetailPanel', () => ({
  TestDetailPanel: ({
    testQuestionLayout,
    onDraftFlushReady,
    onDraftPristineCheckReady,
  }: {
    testQuestionLayout?: string
    onDraftFlushReady?: (flush: (() => Promise<boolean>) | null) => void
    onDraftPristineCheckReady?: (
      check: (() => { isPristine: boolean; draftVersion: number; testUpdatedAt: string }) | null
    ) => void
  }) => {
    onDraftFlushReady?.(draftFlush)
    onDraftPristineCheckReady?.(draftPristineCheck)
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
  initialView = 'edit',
  discardPristineOnClose = false,
  onDiscardPristine = vi.fn(async (_draftVersion: number, _testUpdatedAt: string) => true),
}: {
  hasPendingMarkdownImport?: boolean
  onRequestPreview?: (preview: { testId: string; title: string }) => void
  onRequestPublish?: () => Promise<boolean>
  onClose?: () => void
  testOverride?: TestAssessmentWithStats
  initialView?: 'edit' | 'markdown'
  discardPristineOnClose?: boolean
  onDiscardPristine?: (draftVersion: number, testUpdatedAt: string) => Promise<boolean>
} = {}) {
  render(
    <TooltipProvider>
      <TeacherTestAuthoringDialog
        isOpen
        initialView={initialView}
        test={testOverride}
        classroomId="classroom-1"
        apiBasePath="/api/teacher/tests"
        hasPendingMarkdownImport={hasPendingMarkdownImport}
        onClose={onClose}
        discardPristineOnClose={discardPristineOnClose}
        onDiscardPristine={onDiscardPristine}
        onDraftSummaryChange={vi.fn()}
        onTestUpdate={vi.fn()}
        onPendingMarkdownImportChange={vi.fn()}
        onRequestPreview={onRequestPreview}
        onRequestPublish={onRequestPublish}
      />
    </TooltipProvider>,
  )

  return { onClose, onRequestPreview, onRequestPublish, onDiscardPristine }
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

    const preview = within(dialog).getByRole('button', { name: 'Preview' })
    expect(preview).toHaveTextContent(/^$/)
    fireEvent.click(preview)
    expect(onRequestPreview).toHaveBeenCalledWith({
      testId: 'test-1',
      title: 'Unit Test',
    })
  })

  it('starts in Markdown when requested while allowing the visual mode', () => {
    renderDialog({ initialView: 'markdown' })
    expect(screen.getByTestId('test-authoring-detail')).toHaveAttribute('data-question-layout', 'markdown-only')
    fireEvent.click(screen.getByRole('button', { name: 'Code' }))
    expect(screen.getByTestId('test-authoring-detail')).toHaveAttribute('data-question-layout', 'editor-only')
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

  it('shows publication errors inside the authoring dialog', () => {
    render(
      <TooltipProvider>
        <TeacherTestAuthoringDialog
          isOpen
          test={test}
          classroomId="classroom-1"
          apiBasePath="/api/teacher/tests"
          hasPendingMarkdownImport={false}
          publicationError="Add a title before publishing this Test"
          onClose={vi.fn()}
          onDraftSummaryChange={vi.fn()}
          onTestUpdate={vi.fn()}
          onPendingMarkdownImportChange={vi.fn()}
          onRequestPreview={vi.fn()}
          onRequestPublish={vi.fn(async () => false)}
        />
      </TooltipProvider>,
    )

    expect(
      within(screen.getByRole('dialog', { name: 'Edit test' })).getByRole('alert'),
    ).toHaveTextContent('Add a title before publishing this Test')
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

  it('discards a newly created pristine Test after flushing instead of keeping it', async () => {
    draftFlush.mockClear()
    draftPristineCheck.mockReturnValueOnce({
      isPristine: true,
      draftVersion: 7,
      testUpdatedAt: '2024-10-10T10:00:00Z',
    })
    const onClose = vi.fn()
    const onDiscardPristine = vi.fn(async () => true)
    renderDialog({
      onClose,
      discardPristineOnClose: true,
      onDiscardPristine,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    await waitFor(() => expect(onDiscardPristine).toHaveBeenCalledTimes(1))
    expect(onDiscardPristine).toHaveBeenCalledWith(7, '2024-10-10T10:00:00Z')
    expect(draftFlush).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('keeps an edited newly created Test on close', async () => {
    draftPristineCheck.mockReturnValueOnce({
      isPristine: false,
      draftVersion: 7,
      testUpdatedAt: '2024-10-10T10:00:00Z',
    })
    const onClose = vi.fn()
    const onDiscardPristine = vi.fn(async () => true)
    renderDialog({
      onClose,
      discardPristineOnClose: true,
      onDiscardPristine,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(onDiscardPristine).not.toHaveBeenCalled()
  })
})
