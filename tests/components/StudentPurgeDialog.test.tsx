import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StudentPurgeDialog } from '@/components/StudentPurgeDialog'
import { cleanupKey } from '@/lib/live-student-cleanup-client'
import { invalidateCachedJSONMatching } from '@/lib/request-cache'

const classroomId = '10000000-0000-4000-8000-000000000001'
const target = { student_id: '20000000-0000-4000-8000-000000000001', generation_id: '30000000-0000-4000-8000-000000000001', email: 'student@example.com', name: 'Ada Lovelace' }
const opId = '40000000-0000-4000-8000-000000000001'
const pending = { operation_id: opId, status: 'provider_pending', cleanup_completed: false, pal: 'pending', bara: 'deleting', local_status: 'not_started', blockers: [] }
const done = { ...pending, status: 'completed', cleanup_completed: true, pal: 'completed', bara: 'deleted', local_status: 'local_completed' }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const discovery = (patch = {}) => response({ generation_id: target.generation_id, enabled: true, operation: null, ...patch })
const props = { classroomId, classroomTitle: 'Biology', targets: [target], isOpen: true, onClose: vi.fn(), onCompleted: vi.fn() }
async function open() {
  const view = render(<StudentPurgeDialog {...props} />)
  fireEvent.change(screen.getByRole('combobox'), { target: { value: target.generation_id } })
  await waitFor(() => expect(screen.getByRole('button', { name: /^(Check progress|Done)$/ })).toBeEnabled())
  return view
}
async function confirm() {
  fireEvent.change(await screen.findByRole('textbox'), { target: { value: target.email } })
  fireEvent.click(screen.getByRole('button', { name: 'Delete live class data' }))
}
beforeEach(() => {
  sessionStorage.clear(); vi.clearAllMocks(); invalidateCachedJSONMatching('live-cleanup:')
  vi.spyOn(crypto, 'randomUUID').mockReturnValue(opId)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('teacher live cleanup dialog', () => {
  it('discovers read-only, describes truthful scope, and requires exact confirmation', async () => {
    const fetch = vi.fn().mockResolvedValue(discovery()); vi.stubGlobal('fetch', fetch)
    await open()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toMatch(/\/purge\/live$/)
    expect(screen.getByRole('dialog')).toHaveTextContent(/Historical backups and inactive archives or exports are outside/)
    expect(screen.getByRole('dialog')).toHaveTextContent(/Their account, other classes, classmates, and shared materials are kept/)
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('button', { name: 'Delete live class data' })).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: target.email.toUpperCase() } })
    expect(screen.getByRole('button', { name: 'Delete live class data' })).toBeDisabled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalledOnce()
  })
  it('persists before reserve and advances at most once per explicit click', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(discovery()).mockImplementation(async (_url, init) => {
      const body = JSON.parse(init.body)
      expect(JSON.parse(sessionStorage.getItem(cleanupKey(classroomId, target))!)).toMatchObject({ operation_id: body.operation_id, policy: 'pika-live-v1' })
      return response({ operation: pending }, 202)
    }); vi.stubGlobal('fetch', fetch)
    await open(); await confirm()
    await screen.findByText('Waiting for linked services.')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ action: 'reserve', operation_id: opId, generation_id: target.generation_id, confirmation: 'PURGE LIVE CLASSROOM DATA' })
    fireEvent.click(screen.getByRole('button', { name: 'Continue cleanup' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
    expect(JSON.parse(fetch.mock.calls[2][1].body).action).toBe('advance')
    expect(props.onCompleted).not.toHaveBeenCalled()
  })
  it('recovers a lost reserve response across unmount and reuses the saved operation', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(discovery()).mockRejectedValueOnce(new Error('Lost response'))
      .mockResolvedValueOnce(response({}, 404)).mockResolvedValueOnce(response({ operation: pending }, 202))
    vi.stubGlobal('fetch', fetch)
    const view = await open(); await confirm(); await screen.findByRole('alert')
    view.unmount(); await open()
    expect(fetch.mock.calls[2][0]).toContain(`operation_id=${opId}&generation_id=${target.generation_id}`)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: target.email } })
    fireEvent.click(screen.getByRole('button', { name: 'Retry saved request' }))
    await screen.findByText('Cleanup is paused. Saved progress is available.')
    expect(JSON.parse(fetch.mock.calls[3][1].body).operation_id).toBe(opId)
    expect(crypto.randomUUID).toHaveBeenCalledOnce()
  })
  it('reads saved progress while paused and does not authorize Continue', async () => {
    sessionStorage.setItem(cleanupKey(classroomId, target), JSON.stringify({ operation_id: opId, policy: 'pika-live-v1' }))
    const fetch = vi.fn().mockResolvedValue(response({ operation: pending, enabled: false })); vi.stubGlobal('fetch', fetch)
    await open()
    expect(screen.getByRole('button', { name: 'Continue cleanup' })).toBeDisabled()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it.each([{}, { ...done, operation_id: target.student_id }, { ...done, bara: 'blocked' }])('rejects unverified completion %j', async invalid => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(discovery()).mockResolvedValue(response({ operation: invalid })))
    await open(); await confirm(); await screen.findByRole('alert')
    expect(props.onCompleted).not.toHaveBeenCalled()
  })
  it('notifies completion only after server status proves all stages complete', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(discovery({ operation: done })))
    await open()
    expect(props.onCompleted).toHaveBeenCalledOnce()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Done' })).toBeEnabled()
  })
  it('never falls back to legacy endpoints on discovery failure or stale generation', async () => {
    const fetch = vi.fn().mockResolvedValue(discovery({ generation_id: opId })); vi.stubGlobal('fetch', fetch)
    await open()
    expect(screen.getByRole('alert')).toHaveTextContent('membership changed')
    expect(screen.queryByRole('button', { name: 'Delete live class data' })).not.toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('suppresses duplicate requests and ignores a response after unmount', async () => {
    let resolve!: (result: Response) => void
    const fetch = vi.fn().mockResolvedValueOnce(discovery()).mockImplementation(() => new Promise<Response>(r => { resolve = r }))
    vi.stubGlobal('fetch', fetch)
    const view = await open(); await confirm()
    fireEvent.click(screen.getByRole('button', { name: 'Retry saved request' }))
    expect(fetch).toHaveBeenCalledTimes(2)
    view.unmount()
    await act(async () => { resolve(response({ operation: done })) })
    expect(props.onCompleted).not.toHaveBeenCalled()
  })
})

it('blocks reservation when durable browser recovery storage cannot be written', async () => {
  const fetch = vi.fn().mockResolvedValue(discovery()); vi.stubGlobal('fetch', fetch)
  await open()
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Recovery storage unavailable') })
  await confirm(); await screen.findByRole('alert')
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(props.onCompleted).not.toHaveBeenCalled()
})

it('keeps unsupported live-data blockers pending and does not permit an advance', async () => {
  const fetch = vi.fn().mockResolvedValue(discovery({ operation: { ...pending, blockers: ['shared_resource_policy_required'] } }))
  vi.stubGlobal('fetch', fetch); await open()
  expect(screen.getByText(/Cleanup needs attention/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Continue cleanup' })).toBeDisabled()
  expect(screen.queryByText('shared_resource_policy_required')).not.toBeInTheDocument()
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('ignores completion from a previous classroom after the scope changes', async () => {
  let resolve!: (result: Response) => void
  const fetch = vi.fn().mockResolvedValueOnce(discovery()).mockImplementationOnce(() => new Promise<Response>(r => { resolve = r }))
    .mockResolvedValue(discovery())
  vi.stubGlobal('fetch', fetch)
  const view = await open(); await confirm()
  view.rerender(<StudentPurgeDialog key="new-classroom" {...props} classroomId={target.student_id} />)
  await act(async () => { resolve(response({ operation: done })) })
  expect(props.onCompleted).not.toHaveBeenCalled()
  expect(screen.queryByText(/Cleanup verified/)).not.toBeInTheDocument()
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('retains the displayed operation if session storage is cleared between steps', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(discovery({ operation: pending })).mockResolvedValue(response({ operation: pending }))
  vi.stubGlobal('fetch', fetch); await open()
  sessionStorage.clear()
  fireEvent.click(screen.getByRole('button', { name: 'Continue cleanup' }))
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
  expect(JSON.parse(fetch.mock.calls[1][1].body).operation_id).toBe(opId)
  expect(crypto.randomUUID).not.toHaveBeenCalled()
})
