import { describe, expect, it, vi } from 'vitest'
import { waitForLifecycleCaptureReady } from '../../e2e/helpers/contextual-test-lifecycle-workflow'
import { lifecycleScreens, lifecycleReference, lifecycleText } from '../../e2e/helpers/contextual-test-lifecycle-contract'

const observations = vi.hoisted(() => [] as string[])
type Target = { key: string; scrollIntoViewIfNeeded: () => Promise<void>; getByText: (text: string, options: { exact: boolean }) => Target }
vi.mock('@playwright/test', () => ({ expect: (target: { key: string }) => ({
  toBeVisible: async () => { observations.push(`visible:${target.key}`) },
  toBeHidden: async () => { observations.push(`hidden:${target.key}`) },
  toHaveText: async (text: string) => { observations.push(`text:${target.key}:${text}`) },
  toHaveValue: async (value: string) => { observations.push(`value:${target.key}:${value}`) },
  toBeChecked: async () => { observations.push(`checked:${target.key}`) },
}) }))

describe('lifecycle screenshots wait for their actual state (CPU only)', () => {
  it.each(lifecycleScreens.map(scene => scene.label))('waits before capture: %s', async label => {
    observations.length = 0
    const target = (key: string): Target => ({
      key, scrollIntoViewIfNeeded: async () => { observations.push(`scroll:${key}`) },
      getByText: (text, options) => { expect(options.exact).toBe(true); return target(`${key}:${text}`) },
    })
    const page = {
      getByText: (text: string, options: { exact: boolean }) => { expect(options.exact).toBe(true); return target(text) },
      getByTestId: (id: string) => target(id),
      getByRole: (role: string, options: { name: string | RegExp; exact?: boolean }) => {
        if(role==='radio')expect(options.exact).toBe(true)
        return target(`${role}:${options.name}`)
      },
    }
    await waitForLifecycleCaptureReady(page as never, label, 'member-id')
    const expected = label.includes('preview') ? [`visible:${lifecycleReference}`]
      : label === 'lifecycle-learner-recovery' ? ['visible:student-test-split-container','hidden:exam-interaction-blocker',
        `value:textbox:/Response for question/:${lifecycleText('memberStudent')}`,'checked:radio:Beta',
        'visible:student-test-action-footer:Saved','scroll:textbox:/Response for question/']
      : label === 'lifecycle-learner-submitted' ? ['visible:Response Submitted']
      : label === 'lifecycle-learner-returned' ? ['visible:Lifecycle manual feedback','scroll:Lifecycle manual feedback']
      : label === 'lifecycle-learner-cleared' ? ['visible:Score: Pending grading','scroll:Score: Pending grading','hidden:Lifecycle manual feedback']
      : ['visible:test-grading-student-row-member-id']
    expect(observations).toEqual(expected)
  })
  it('does not proceed to capture when the state is missing', async () => {
    const page = { getByText: () => { throw Error('State is not rendered') } }
    await expect(waitForLifecycleCaptureReady(page as never, 'lifecycle-learner-returned', 'member-id')).rejects.toThrow('State is not rendered')
  })
})
