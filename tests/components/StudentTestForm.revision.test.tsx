import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
// UiGallery's StudentTestAttemptPattern uses this production form for its interactive fixture.
import { StudentTestForm } from '@/components/StudentTestForm'
import { createMockTestQuestion } from '../helpers/mocks'

const questions = [createMockTestQuestion({ id: 'q1', question_text: 'Explain.', question_type: 'open_response', options: [] })]
const response = (revision: number) => ({ ok: true, status: 200, json: async () => ({ attempt: { draft_revision: revision } }) })
const bodyAt = (fetchMock: ReturnType<typeof vi.fn>, index: number) => JSON.parse(fetchMock.mock.calls[index][1].body)
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-04T12:00:00Z')); fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); localStorage.clear() })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('serializes full snapshots and uses the acknowledged revision even while a prior save is delayed', async () => {
  let release!: (value: ReturnType<typeof response>) => void
  fetchMock.mockReturnValueOnce(new Promise(resolve => { release = resolve })).mockResolvedValueOnce(response(800))
  render(<StudentTestForm testId="revision-queue" questions={questions} initialDraftRevision={41} enableDraftAutosave onSubmitted={vi.fn()} />)
  const textbox = screen.getByRole('textbox')
  fireEvent.change(textbox, { target: { value: 'Earlier answer' } })
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(bodyAt(fetchMock, 0).expected_revision).toBe(41)
  fireEvent.change(textbox, { target: { value: 'Latest answer' } })
  await act(async () => { await vi.advanceTimersByTimeAsync(20000) })
  expect(fetchMock).toHaveBeenCalledTimes(1)
  await act(async () => { release(response(700)); await Promise.resolve() })
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(bodyAt(fetchMock, 1)).toMatchObject({ expected_revision: 700, responses: { q1: { response_text: 'Latest answer' } } })
  expect(textbox).toHaveValue('Latest answer')
})

it('preserves local work on revision conflict, pauses retries and submission, then loads saved answers only after confirmation', async () => {
  fetchMock.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: 'Answers changed in another tab.', error_code: 'test_attempt_revision_conflict', attempt: { draft_revision: 700, responses: { q1: { question_type: 'open_response', response_text: 'Server answer' } } } }) })
  render(<StudentTestForm testId="revision-conflict" questions={questions} initialDraftRevision={41} enableDraftAutosave onSubmitted={vi.fn()} />)
  const textbox = screen.getByRole('textbox')
  fireEvent.change(textbox, { target: { value: 'My retained answer' } })
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(textbox).toHaveValue('My retained answer')
  expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled()
  fireEvent.change(textbox, { target: { value: 'Still retained' } })
  await act(async () => { await vi.advanceTimersByTimeAsync(30000) })
  expect(fetchMock).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Load saved answers' }))
  expect(textbox).toHaveValue('Still retained')
  fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ attempt: { draft_revision: 900, responses: { q1: { question_type: 'open_response', response_text: 'Newest server answer' } } } }) })
  await act(async () => { fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Load saved answers' })) })
  expect(fetchMock.mock.calls[1][0]).toContain('/attempt')
  expect(textbox).toHaveValue('Newest server answer')
  expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled()
})

it('does not send an unfenced write when no authoritative revision was supplied', async () => {
  render(<StudentTestForm testId="revision-missing" questions={questions} enableDraftAutosave onSubmitted={vi.fn()} />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Retain me' } })
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(fetchMock).not.toHaveBeenCalled()
  expect(screen.getByRole('alert')).toHaveTextContent('Reload')
  expect(screen.getByRole('textbox')).toHaveValue('Retain me')
})


it('does not discard local answers or adopt a refreshed revision during an active save', async () => {
  let release!: (value: ReturnType<typeof response>) => void
  fetchMock.mockReturnValueOnce(new Promise(resolve => { release = resolve }))
  const onSubmitted = vi.fn()
  const view = render(<StudentTestForm testId="revision-refresh" questions={questions} initialDraftRevision={41} enableDraftAutosave onSubmitted={onSubmitted} />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My edit' } })
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  view.rerender(<StudentTestForm testId="revision-refresh" questions={questions} initialDraftRevision={999} initialResponses={{q1:{question_type:'open_response',response_text:'Other tab'}}} enableDraftAutosave onSubmitted={onSubmitted} />)
  expect(screen.getByRole('textbox')).toHaveValue('My edit')
  await act(async () => { release(response(700)); await Promise.resolve() })
  expect(screen.getByRole('textbox')).toHaveValue('My edit')
})

it('does not submit after the required final draft save fails', async () => {
  fetchMock.mockResolvedValueOnce({ ok:false, status:500, json:async () => ({error:'Save unavailable'}) })
  const onSubmitted = vi.fn()
  render(<StudentTestForm testId="revision-submit-failure" questions={questions} initialDraftRevision={41} enableDraftAutosave onSubmitted={onSubmitted} />)
  fireEvent.change(screen.getByRole('textbox'), { target:{value:'Final answer'} })
  fireEvent.click(screen.getByRole('button', {name:'Submit'}))
  await act(async () => { fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Submit'})) })
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(fetchMock.mock.calls[0][0]).toContain('/attempt')
  expect(onSubmitted).not.toHaveBeenCalled()
  expect(screen.getByRole('textbox')).toHaveValue('Final answer')
  expect(screen.getByRole('alert')).toHaveTextContent('Save unavailable')
})

it('flushes the latest pending draft with a blur save on genuine unmount', async () => {
  fetchMock.mockResolvedValueOnce(response(42))
  const view = render(<StudentTestForm testId="revision-unmount" questions={questions} initialDraftRevision={41} enableDraftAutosave onSubmitted={vi.fn()} />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Latest unsaved answer' } })
  expect(fetchMock).not.toHaveBeenCalled()
  await act(async () => { view.unmount() })
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(bodyAt(fetchMock, 0)).toMatchObject({ trigger: 'blur', expected_revision: 41, responses: { q1: { response_text: 'Latest unsaved answer' } } })
  await act(async () => { await vi.advanceTimersByTimeAsync(20000) })
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

it('forces a final draft save before submission even when the answer was already autosaved', async () => {
  fetchMock.mockResolvedValueOnce(response(42)).mockResolvedValueOnce(response(43)).mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })
  const onSubmitted = vi.fn()
  render(<StudentTestForm testId="revision-submit-success" questions={questions} initialDraftRevision={41} enableDraftAutosave onSubmitted={onSubmitted} />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Final answer' } })
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
  await act(async () => { fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Submit' })) })
  expect(fetchMock).toHaveBeenCalledTimes(3)
  expect(fetchMock.mock.calls[1][0]).toContain('/attempt')
  expect(bodyAt(fetchMock, 1)).toMatchObject({ trigger: 'blur', expected_revision: 42 })
  expect(fetchMock.mock.calls[2][0]).toContain('/respond')
  expect(bodyAt(fetchMock, 2)).toMatchObject({ expected_revision: 43 })
  expect(onSubmitted).toHaveBeenCalledTimes(1)
})

it('keeps the final answer visible and locked while submission is pending', async () => {
  let finishSubmit!: (value: { ok: boolean; json: () => Promise<object> }) => void
  fetchMock.mockResolvedValueOnce(response(42)).mockReturnValueOnce(new Promise(resolve => { finishSubmit = resolve }))
  const onSubmitted = vi.fn()
  const onSubmissionStateChange = vi.fn()
  render(<StudentTestForm testId="submit-pending" questions={questions} initialDraftRevision={41} enableDraftAutosave onSubmitted={onSubmitted} onSubmissionStateChange={onSubmissionStateChange} />)
  const textbox = screen.getByRole('textbox')
  fireEvent.change(textbox, { target: { value: 'My final answer' } })
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
  await act(async () => { fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Submit' })) })
  expect(textbox).toBeVisible()
  expect(textbox).toHaveValue('My final answer')
  expect(textbox).toBeDisabled()
  expect(onSubmissionStateChange).toHaveBeenCalledWith(true)
  expect(onSubmitted).not.toHaveBeenCalled()
  await act(async () => { finishSubmit({ ok: true, json: async () => ({ success: true }) }) })
  expect(onSubmitted).toHaveBeenCalledTimes(1)
})

it('confirms an ambiguous submission from the server before reporting success', async () => {
  fetchMock.mockResolvedValueOnce(response(42)).mockRejectedValueOnce(new TypeError('Network error')).mockResolvedValueOnce({ ok: true, json: async () => ({ attempt: { is_submitted: true, responses: { q1: { question_type: 'open_response', response_text: 'Final answer' } } } }) })
  const onSubmitted = vi.fn()
  render(<StudentTestForm testId="submit-ambiguous" questions={questions} initialDraftRevision={41} enableDraftAutosave onSubmitted={onSubmitted} />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Final answer' } })
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
  await act(async () => { fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Submit' })) })
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    expect.stringContaining('/attempt'), expect.stringContaining('/respond'), expect.stringContaining('/attempt'),
  ])
  expect(fetchMock.mock.calls[2][1]?.method || 'GET').toBe('GET')
  expect(onSubmitted).toHaveBeenCalledTimes(1)
})

it('retains locked answers when submission status is uncertain and checks again before reporting success', async () => {
  fetchMock.mockResolvedValueOnce(response(42)).mockRejectedValueOnce(new TypeError('Network error')).mockRejectedValueOnce(new TypeError('Network error'))
  const onSubmitted = vi.fn()
  render(<StudentTestForm testId="submit-unconfirmed" questions={questions} initialDraftRevision={41} enableDraftAutosave onSubmitted={onSubmitted} />)
  const textbox = screen.getByRole('textbox')
  fireEvent.change(textbox, { target: { value: 'Retained answer' } })
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
  await act(async () => { fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Submit' })) })
  expect(screen.getByText(/We could not confirm your submission/i)).toBeInTheDocument()
  expect(textbox).toHaveValue('Retained answer')
  expect(textbox).toBeDisabled()
  expect(onSubmitted).not.toHaveBeenCalled()
  // A negative read can race a still-committing POST, so it must not unlock retry.
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ attempt: { is_submitted: false } }) })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check submission status' })) })
  expect(textbox).toBeDisabled()
  expect(onSubmitted).not.toHaveBeenCalled()
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ attempt: { is_submitted: true, responses: { q1: { question_type: 'open_response', response_text: 'Retained answer' } } } }) })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check submission status' })) })
  expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/respond'))).toHaveLength(1)
  expect(onSubmitted).toHaveBeenCalledTimes(1)
})


it('does not report a receipt when the submitted answers differ from the displayed answers', async () => {
  fetchMock.mockResolvedValueOnce(response(42)).mockRejectedValueOnce(new TypeError('Network error')).mockResolvedValueOnce({ ok: true, json: async () => ({ attempt: { is_submitted: true, responses: { q1: { question_type: 'open_response', response_text: 'Different answer' } } } }) })
  const onSubmitted = vi.fn()
  render(<StudentTestForm testId="submit-mismatch" questions={questions} initialDraftRevision={41} enableDraftAutosave onSubmitted={onSubmitted} />)
  const textbox = screen.getByRole('textbox')
  fireEvent.change(textbox, { target: { value: 'My final answer' } })
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
  await act(async () => { fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Submit' })) })
  expect(onSubmitted).not.toHaveBeenCalled()
  expect(textbox).toHaveValue('My final answer')
  expect(textbox).toBeDisabled()
  expect(screen.getByText(/does not match the answers shown here/i)).toBeInTheDocument()
})

it('does not report success when a pending submission resolves after unmount', async () => {
  let finishSubmit!: (value: { ok: boolean; json: () => Promise<object> }) => void
  fetchMock.mockResolvedValueOnce(response(42)).mockReturnValueOnce(new Promise(resolve => { finishSubmit = resolve }))
  const onSubmitted = vi.fn()
  const view = render(<StudentTestForm testId="submit-unmounted" questions={questions} initialDraftRevision={41} enableDraftAutosave onSubmitted={onSubmitted} />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Final answer' } })
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
  await act(async () => { fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Submit' })) })
  view.unmount()
  await act(async () => { finishSubmit({ ok: true, json: async () => ({ success: true }) }) })
  expect(onSubmitted).not.toHaveBeenCalled()
})

it('checks the saved attempt after a hung submission times out without posting again', async () => {
  fetchMock.mockResolvedValueOnce(response(42)).mockImplementationOnce((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
    options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
  })).mockResolvedValueOnce({ ok: true, json: async () => ({ attempt: { is_submitted: true, responses: { q1: { question_type: 'open_response', response_text: 'Final answer' } } } }) })
  const onSubmitted = vi.fn()
  render(<StudentTestForm testId="submit-timeout" questions={questions} initialDraftRevision={41} enableDraftAutosave onSubmitted={onSubmitted} />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Final answer' } })
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
  await act(async () => { fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Submit' })) })
  await act(async () => { await vi.advanceTimersByTimeAsync(29_999) })
  expect(onSubmitted).not.toHaveBeenCalled()
  expect(fetchMock).toHaveBeenCalledTimes(2)
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/respond'))).toHaveLength(1)
  expect(fetchMock.mock.calls[2][0]).toContain('/attempt')
  expect(fetchMock.mock.calls[2][1]?.method || 'GET').toBe('GET')
  expect(onSubmitted).toHaveBeenCalledTimes(1)
})
