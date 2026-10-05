import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
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
