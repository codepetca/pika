import { describe, expect, it, vi } from 'vitest'
import { openLifecycleOwnerWorkspace, prepareLifecycleCapture } from '../../e2e/helpers/contextual-test-lifecycle-workflow'

const observations = vi.hoisted(() => [] as string[])
vi.mock('@playwright/test', () => ({ expect: (target: { key: string }) => ({
  toBeVisible: async () => { observations.push(`visible:${target.key}`) },
}) }))
const classUrl = 'http://localhost:3117/classrooms/synthetic?tab=tests'
function setup(url: string, failLink = false) {
  observations.length = 0
  const page = {
    url: () => url,
    getByRole: (role: string, options: { name: string; exact: boolean }) => {
      expect(options.exact).toBe(true)
      const key = `${role}:${options.name}`
      return { key, click: async () => { observations.push(`click:${key}`); if (failLink && role === 'link') throw Error('Navigation failed') } }
    },
  }
  const runtime = { navigate: async (_page: unknown, url: string) => { expect(url).toBe(classUrl); observations.push('document') } }
  return { page, runtime }
}
describe('bounded lifecycle workspace navigation', () => {
  it('uses the existing Tests link and waits for the list before selecting again', async () => {
    const { page, runtime } = setup(`${classUrl}&testId=main&testMode=grading&testStudentId=member`)
    await openLifecycleOwnerWorkspace(runtime, page as never, classUrl, 'Main')
    expect(observations).toEqual(['click:link:Tests', 'visible:button:Create test', 'click:button:Main'])
  })
  it.each(['http://localhost:3117/classrooms', 'http://localhost:3117/classrooms/other?tab=tests',
    'http://localhost:3117/classrooms/synthetic?tab=daily', 'http://different.invalid/classrooms/synthetic?tab=tests'])('loads the exact class from outside its Tests screen: %s', async url => {
    const { page, runtime } = setup(url)
    await openLifecycleOwnerWorkspace(runtime, page as never, classUrl, 'Main')
    expect(observations).toEqual(['document', 'visible:button:Create test', 'click:button:Main'])
  })
  it('preserves explicit document reload for authored save/readback', async () => {
    const { page, runtime } = setup(`${classUrl}&testId=main`)
    await openLifecycleOwnerWorkspace(runtime, page as never, classUrl, 'Main', true)
    expect(observations).toEqual(['document', 'visible:button:Create test', 'click:button:Main'])
  })
  it('does not replace a failed UI navigation with a silent reload or retry', async () => {
    const { page, runtime } = setup(classUrl, true)
    await expect(openLifecycleOwnerWorkspace(runtime, page as never, classUrl, 'Main')).rejects.toThrow('Navigation failed')
    expect(observations).toEqual(['click:link:Tests'])
  })
})
describe('single-navigation standalone preview preference', () => {
  it('sets dark preference through the authenticated same-context page, not about:blank', async () => {
    const context = {}, calls: string[] = []
    const page = { context: () => context,
      setViewportSize: async (size: unknown) => { expect(size).toEqual({ width: 1440, height: 900 }); calls.push('viewport') },
      emulateMedia: async (media: unknown) => { expect(media).toEqual({ colorScheme: 'dark' }); calls.push('media') },
      evaluate: async () => { throw Error('about:blank cannot access localStorage') },
    }
    const owner = { context: () => context, evaluate: async (_callback: unknown, theme: string) => { expect(theme).toBe('dark'); calls.push('owner-preference') } }
    const scene = await prepareLifecycleCapture(page as never, 'lifecycle-standalone-preview', owner as never)
    expect(scene.label).toBe('lifecycle-standalone-preview')
    expect(calls).toEqual(['viewport', 'media', 'owner-preference'])
  })
  it('rejects another context before changing any view or preference', async () => {
    const page = { context: () => ({}), setViewportSize: vi.fn() }
    const owner = { context: () => ({}), evaluate: vi.fn() }
    await expect(prepareLifecycleCapture(page as never, 'lifecycle-standalone-preview', owner as never)).rejects.toThrow()
    expect(page.setViewportSize).not.toHaveBeenCalled(); expect(owner.evaluate).not.toHaveBeenCalled()
  })
})
