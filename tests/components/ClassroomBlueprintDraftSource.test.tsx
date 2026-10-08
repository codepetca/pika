import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { startTransition, Suspense, useState } from 'react'
import { ClassroomBlueprintDraftSource } from '@/components/ClassroomBlueprintDraftSource'
import { invalidateCachedJSONMatching } from '@/lib/request-cache'

beforeEach(() => {
  vi.restoreAllMocks()
  invalidateCachedJSONMatching('classroom-draft-source:')
})

describe('ClassroomBlueprintDraftSource', () => {
  it('publishes the committed open request while a close render is suspended', async () => {
    const pending = new Promise<void>(() => {})
    let finish!: (response: Response) => void
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve }))
    let close!: (value: boolean) => void
    let suspendedAttempts = 0
    function Suspender({ closed }: { closed: boolean }) {
      if (closed) { suspendedAttempts += 1; throw pending }
      return null
    }
    function Parent() {
      const [closed, setClosed] = useState(false)
      close = setClosed
      return <Suspense fallback={<p>Pending</p>}>
        <ClassroomBlueprintDraftSource classroomId="classroom-1" target="assignments" artifactId="committed-source" isOpen={!closed} />
        <Suspender closed={closed} />
      </Suspense>
    }
    render(<Parent />)
    expect(fetchMock).toHaveBeenCalledOnce()
    act(() => { startTransition(() => close(true)) })
    expect(suspendedAttempts).toBeGreaterThan(0)
    await act(async () => {
      finish({ ok: true, json: async () => ({ provenance: { source_blueprint_version_number: 11, unit_label: 'Committed source' } }) } as Response)
    })
    expect(screen.getByText('Drafted with Blueprint Version 11 · Committed source')).toBeInTheDocument()
    act(() => { close(false) })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('removes a loaded note immediately on close for callers without presentation retention', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ provenance: { source_blueprint_version_number: 8, unit_label: 'Default source' } }),
    } as Response)
    const props = { classroomId: 'classroom-1', target: 'assignments' as const, artifactId: 'assignment-default' }
    const { rerender } = render(<ClassroomBlueprintDraftSource {...props} isOpen />)
    const note = await screen.findByText('Drafted with Blueprint Version 8 · Default source')
    rerender(<ClassroomBlueprintDraftSource {...props} isOpen={false} />)
    expect(note).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('shows the teacher a saved source after loading private provenance', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ provenance: { source_blueprint_version_number: 4, unit_label: 'Loops' } }),
    } as Response)

    render(
      <ClassroomBlueprintDraftSource
        classroomId="classroom-1"
        target="tests"
        artifactId="test-1"
        isOpen
      />,
    )

    expect(await screen.findByText('Drafted with Blueprint Version 4 · Loops')).toBeInTheDocument()
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/teacher/classrooms/classroom-1/authoring-drafts/provenance?target=tests&artifact_id=test-1',
    )
  })

  it('does not request source metadata for a new or closed editor', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    render(
      <ClassroomBlueprintDraftSource
        classroomId="classroom-1"
        target="assignments"
        artifactId={null}
        isOpen
      />,
    )
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled())
  })
})
