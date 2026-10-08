import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ClassroomBlueprintDraftDialog } from '@/components/ClassroomBlueprintDraftDialog'
import { invalidateCachedJSONMatching } from '@/lib/request-cache'

function response(value: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(value) } as Response)
}

beforeEach(() => {
  vi.restoreAllMocks()
  invalidateCachedJSONMatching('classroom-authoring-guidance:')
})

describe('ClassroomBlueprintDraftDialog', () => {
  it('keeps creation unavailable when the classroom has no frozen Blueprint Version', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockReturnValue(response({ context: null }))
    render(
      <ClassroomBlueprintDraftDialog
        isOpen
        classroomId="classroom-1"
        target="tests"
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    )

    expect(await screen.findByText(/no saved Blueprint Version/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Generate draft' })).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('sends edited Markdown and the signed preview proof when creating a draft', async () => {
    const created = vi.fn()
    const closed = vi.fn()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(response({ context: {
        source_blueprint_version_id: 'version-1',
        source_blueprint_version_number: 3,
        guidance: {
          course_expectations_markdown: 'Course rules',
          assignment_guidance_markdown: 'Assignment rules',
          test_guidance_markdown: 'Test rules',
          unit_exceptions: [{
            id: 'unit-1',
            unit_label: 'Unit 1',
            assignment_guidance_markdown: '',
            test_guidance_markdown: 'Unit rules',
          }],
        },
      } }))
      .mockReturnValueOnce(response({ suggestion: {
        content: '# Original test',
        guidance: {
          source_blueprint_version_number: 3,
          unit_exception_id: 'unit-1',
          unit_label: 'Unit 1',
          rules_markdown: 'Course rules\nTest rules\nUnit rules',
        },
        draft_id: 'draft-1',
        original_content_sha256: 'seed-hash',
        draft_provenance_token: 'signed-proof',
      } }))
      .mockReturnValueOnce(response({ test: { id: 'test-1', title: 'Revised test' } }))

    render(
      <ClassroomBlueprintDraftDialog
        isOpen
        classroomId="classroom-1"
        target="tests"
        onClose={closed}
        onCreated={created}
      />,
    )

    fireEvent.change(await screen.findByLabelText('Unit'), { target: { value: 'unit-1' } })
    fireEvent.change(screen.getByLabelText('What should this test cover?'), { target: { value: 'Karel loops' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate draft' }))
    const editor = await screen.findByLabelText('Edit draft Markdown')
    fireEvent.change(editor, { target: { value: '# Revised test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create test draft' }))

    await waitFor(() => expect(created).toHaveBeenCalledWith({ test: { id: 'test-1', title: 'Revised test' } }))
    expect(closed).toHaveBeenCalled()
    expect(JSON.parse(String((fetchMock.mock.calls[2]?.[1] as RequestInit).body))).toEqual({
      target: 'tests',
      content: '# Revised test',
      draft_id: 'draft-1',
      draft_provenance_token: 'signed-proof',
      original_content_sha256: 'seed-hash',
      unit_exception_id: 'unit-1',
    })
  })

  it('drops an earlier generation response after the dialog is reopened', async () => {
    let resolveSuggestion!: (response: Response) => void
    const deferredSuggestion = new Promise<Response>((resolve) => { resolveSuggestion = resolve })
    vi.spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(response({ context: {
        source_blueprint_version_id: 'version-1',
        source_blueprint_version_number: 1,
        guidance: {
          course_expectations_markdown: '',
          assignment_guidance_markdown: '',
          test_guidance_markdown: '',
          unit_exceptions: [],
        },
      } }))
      .mockReturnValueOnce(deferredSuggestion)
      .mockReturnValueOnce(response({ context: null }))

    const props = {
      classroomId: 'classroom-1',
      target: 'tests' as const,
      onClose: vi.fn(),
      onCreated: vi.fn(),
    }
    const view = render(<ClassroomBlueprintDraftDialog {...props} isOpen />)
    fireEvent.click(await screen.findByRole('button', { name: 'Generate draft' }))
    view.rerender(<ClassroomBlueprintDraftDialog {...props} isOpen={false} />)
    view.rerender(<ClassroomBlueprintDraftDialog {...props} classroomId="classroom-2" isOpen />)
    resolveSuggestion({
      ok: true,
      json: async () => ({ suggestion: {
        content: '# Stale test',
        guidance: { source_blueprint_version_number: 1, unit_exception_id: null, unit_label: null, rules_markdown: '' },
        draft_id: 'old', original_content_sha256: 'old', draft_provenance_token: 'old',
      } }),
    } as Response)

    expect(await screen.findByText(/no saved Blueprint Version/i)).toBeInTheDocument()
    expect(screen.queryByLabelText('Edit draft Markdown')).toBeNull()
  })
})
