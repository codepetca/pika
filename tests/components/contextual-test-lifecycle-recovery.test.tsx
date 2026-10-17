import { afterEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import { StudentTestForm } from '@/components/StudentTestForm'
import type { TestAssessmentQuestion } from '@/types'
import { lifecycleText } from '../../e2e/helpers/contextual-test-lifecycle-contract'
import { waitForLifecycleCaptureReady } from '../../e2e/helpers/contextual-test-lifecycle-workflow'

type Target = { element: () => HTMLElement | null }
// Exercise the production readiness helper against actual rendered form state,
// rather than a mock that accepts every Playwright assertion unconditionally.
vi.mock('@playwright/test', () => ({ expect: (target: Target) => ({
  toBeVisible: async () => { expect(target.element()).toBeVisible() },
  toBeHidden: async () => { if (target.element()) expect(target.element()).not.toBeVisible() },
  toHaveText: async (text: string) => { expect(target.element()?.textContent).toBe(text) },
  toHaveValue: async (value: string) => { expect(target.element()).toHaveValue(value) },
  toBeChecked: async () => { expect(target.element()).toBeChecked() },
}) }))

function locator(element: () => HTMLElement | null) {
  return {
    element,
    scrollIntoViewIfNeeded: async () => { expect(element()).toBeVisible() },
    getByText: (text: string, options: { exact: boolean }) => locator(() => within(element()!).getByText(text, options)),
  }
}
const page = {
  getByTestId: (id: string) => locator(() => screen.queryByTestId(id)),
  getByRole: (role: Parameters<typeof screen.getByRole>[0], options: Parameters<typeof screen.getByRole>[1]) =>
    locator(() => screen.getByRole(role, options)),
}
function mountRecovered(text = lifecycleText('memberStudent'), selected = 1, blocked = false) {
  const question = (id: string, position: number, question_type: 'multiple_choice' | 'open_response'): TestAssessmentQuestion => ({
    id, position, question_type, test_id: 'lifecycle-recovery', question_text: id,
    options: question_type === 'multiple_choice' ? ['Alpha', 'Beta'] : [],
    created_at: '2026-10-17T00:00:00Z', updated_at: '2026-10-17T00:00:00Z',
  })
  render(<div data-testid="student-test-split-container">
    {blocked && <div data-testid="exam-interaction-blocker">Locked</div>}
    <StudentTestForm testId="lifecycle-recovery" initialDraftRevision={7}
      questions={[
        question('mc', 0, 'multiple_choice'), question('open', 1, 'open_response'),
      ]}
      initialResponses={{ mc: { question_type: 'multiple_choice', selected_option: selected }, open: { question_type: 'open_response', response_text: text } }}
      enableDraftAutosave onSubmitted={vi.fn()} />
  </div>)
}

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear() })
describe('lifecycle recovery capture with a genuinely fresh form', () => {
  it('accepts recovered answers without a new save announcement or unsolicited write', async () => {
    vi.useFakeTimers(); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    mountRecovered()
    expect(screen.getByText('Saved', { exact: true })).toBeVisible()
    expect(screen.getByTestId('student-test-autosave-status')).toBeEmptyDOMElement()
    await waitForLifecycleCaptureReady(page as never, 'lifecycle-learner-recovery', 'member-id')
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(fetch).not.toHaveBeenCalled()
    expect(screen.getByTestId('student-test-autosave-status')).toBeEmptyDOMElement()
  })
  it.each(['wrong-text', 'wrong-choice', 'blocked'] as const)('rejects incorrect recovery: %s', async kind => {
    mountRecovered(kind === 'wrong-text' ? 'Wrong recovered answer' : undefined, kind === 'wrong-choice' ? 0 : 1, kind === 'blocked')
    await expect(waitForLifecycleCaptureReady(page as never, 'lifecycle-learner-recovery', 'member-id')).rejects.toThrow()
  })
})
