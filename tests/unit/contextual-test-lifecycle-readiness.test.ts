import { describe, expect, it, vi } from 'vitest'
import { waitForLifecycleCaptureReady } from '../../e2e/helpers/contextual-test-lifecycle-workflow'
import { lifecycleScreens, lifecycleReference } from '../../e2e/helpers/contextual-test-lifecycle-contract'

const observations = vi.hoisted(() => [] as string[])
vi.mock('@playwright/test', () => ({ expect: (target: { key: string }) => ({
  toBeVisible: async () => { observations.push(`visible:${target.key}`) },
  toBeHidden: async () => { observations.push(`hidden:${target.key}`) },
  toHaveText: async (text: string) => { observations.push(`text:${target.key}:${text}`) },
}) }))

describe('lifecycle screenshots wait for their actual state (CPU only)', () => {
  it.each(lifecycleScreens.map(scene => scene.label))('waits before capture: %s', async label => {
    observations.length = 0
    const target = (key: string) => ({ key, scrollIntoViewIfNeeded: async () => { observations.push(`scroll:${key}`) } })
    const page = {
      getByText: (text: string, options: { exact: boolean }) => { expect(options.exact).toBe(true); return target(text) },
      getByTestId: (id: string) => target(id),
    }
    await waitForLifecycleCaptureReady(page as never, label, 'member-id')
    const expected = label.includes('preview') ? [`visible:${lifecycleReference}`]
      : label === 'lifecycle-learner-recovery' ? ['text:student-test-autosave-status:Saved']
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
