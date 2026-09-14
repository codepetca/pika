import { expect, test } from '@playwright/test'

const classroom = '30000000-0000-4000-8000-000000000021'
const target = { student_id: '20000000-0000-4000-8000-000000000001', generation_id: '40000000-0000-4000-8000-000000000001', name: 'Ada Lovelace', email: 'ada@example.com' }
const pending = { operation_id: '50000000-0000-4000-8000-000000000001', status: 'provider_pending', cleanup_completed: false, pal: 'pending', bara: 'deleting', local_status: 'not_started', blockers: [] as string[] }
const local = { ...pending, pal: 'completed', bara: 'deleted', local_status: 'deleting' }
const completed = { ...local, status: 'completed', cleanup_completed: true, local_status: 'local_completed' }

for (const viewport of ['desktop', 'mobile'] as const) for (const theme of ['light', 'dark'] as const) {
  test(`${viewport} ${theme}: scoped confirmation, bounded work, recovery and keyboard`, async ({ page }) => {
    test.setTimeout(90_000)
    await page.setViewportSize(viewport === 'desktop' ? { width: 1440, height: 900 } : { width: 390, height: 844 })
    await page.emulateMedia({ colorScheme: theme })
    await page.addInitScript(theme => localStorage.setItem('theme', theme), theme)
    let enabled = true, rosterLoads = 0, advanceCount = 0
    let operation: typeof pending = pending
    const posts: Record<string, string>[] = []
    let releaseDiscovery!: () => void, releaseAdvance!: () => void
    const discoveryWait = new Promise<void>(resolve => { releaseDiscovery = resolve })
    const advanceWait = new Promise<void>(resolve => { releaseAdvance = resolve })
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url())
      if (url.pathname.endsWith('/roster')) {
        rosterLoads += 1
        await route.fulfill({ json: { roster: [], live_cleanup_targets: operation.cleanup_completed ? [] : [target] } }); return
      }
      if (!url.pathname.endsWith('/purge/live')) { await route.fulfill({ status: 403, json: { error: 'Fixture rejects unrelated request' } }); return }
      expect(url.pathname).toBe(`/api/teacher/classrooms/${classroom}/students/${target.student_id}/purge/live`)
      if (route.request().method() === 'GET') {
        if (url.search) {
          expect(url.searchParams.get('operation_id')).toBe(pending.operation_id)
          expect(url.searchParams.get('generation_id')).toBe(target.generation_id)
          await route.fulfill({ json: { operation, enabled } })
        } else {
          await discoveryWait
          await route.fulfill({ json: { generation_id: target.generation_id, operation: null, enabled } })
        }
        return
      }
      const body = route.request().postDataJSON()
      posts.push(body)
      expect(body).toEqual({ action: body.action, operation_id: pending.operation_id,
        generation_id: target.generation_id, confirmation: 'PURGE LIVE CLASSROOM DATA' })
      if (body.action === 'advance') {
        advanceCount += 1
        if (advanceCount === 1) { await advanceWait; operation = local }
        if (advanceCount === 2) { await route.fulfill({ status: 503, json: { error: 'unavailable' } }); return }
        if (advanceCount === 3) { operation = { ...local, errors: [{ stage: 'pal', retryable: true }] } as typeof pending }
        if (advanceCount === 4) operation = completed
      }
      await route.fulfill({ status: operation.cleanup_completed ? 200 : 202, json: { operation } })
    })
    await page.addInitScript(op => { crypto.randomUUID = () => op as `${string}-${string}-${string}-${string}-${string}` }, pending.operation_id)
    const capture = async (state: string) => {
      const dialog = page.getByRole('dialog', { name: 'Clean up live class data' })
      await expect(dialog).toBeVisible()
      const box = await dialog.boundingBox(); expect(box).not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
      await page.screenshot({ path: `output/playwright/live-cleanup/${viewport}-${theme}-${state}.png`, fullPage: true, animations: 'disabled' })
    }
    const open = async () => {
      await page.getByRole('button', { name: 'More actions' }).click()
      await page.getByRole('menuitem', { name: /Clean up live class data/ }).click()
      await page.getByRole('combobox', { name: 'Removed student' }).selectOption(target.generation_id)
    }
    await page.goto('/e2e-fixtures/teacher-live-cleanup')
    await open()
    await expect(page.getByText('Checking removed membership…')).toBeVisible()
    await capture('loading'); releaseDiscovery()
    await expect(page.getByRole('textbox')).toBeVisible()
    await page.getByRole('textbox').fill(target.email)
    await capture('confirmation')
    expect(posts).toHaveLength(0)
    await page.getByRole('button', { name: 'Delete live class data' }).click()
    await expect(page.getByText('Waiting for linked services.')).toBeVisible()
    expect(posts).toHaveLength(1); await capture('provider-waiting')
    await page.getByRole('button', { name: 'Continue cleanup' }).click()
    await capture('pending'); releaseAdvance()
    await expect(page.getByText('Classroom data cleanup is pending.')).toBeVisible()
    expect(posts).toHaveLength(2)
    await page.getByRole('button', { name: 'Continue cleanup' }).click()
    await expect(page.getByRole('alert')).toBeVisible(); await capture('error')
    await page.getByRole('button', { name: 'Check progress' }).click()
    await expect(page.getByRole('button', { name: 'Continue cleanup' })).toBeEnabled(); await capture('retry')
    await page.getByRole('button', { name: 'Continue cleanup' }).click()
    await expect(page.getByText('A service request failed. You can retry the next step.')).toBeVisible()
    await capture('provider-retry')
    enabled = false
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const beforeReopen = posts.length
    await open()
    await expect(page.getByText('Cleanup is paused. Saved progress is available.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Continue cleanup' })).toBeDisabled()
    expect(posts).toHaveLength(beforeReopen); await capture('paused')
    enabled = true
    await page.getByRole('button', { name: 'Check progress' }).click()
    await expect(page.getByRole('button', { name: 'Continue cleanup' })).toBeEnabled()
    await page.getByRole('button', { name: 'Continue cleanup' }).click()
    await expect(page.getByText(/Cleanup verified/)).toBeVisible(); await capture('completed')
    expect(rosterLoads).toBe(2)
    await page.getByRole('button', { name: 'Done' }).focus()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('dialog')).toContainText('Cleanup verified')
    expect(await page.getByRole('dialog').evaluate(el => el.contains(document.activeElement))).toBe(true)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(posts).toHaveLength(5)
    // A reload after completion can read the saved opaque operation even though the roster row is gone.
    await page.reload()
    await open()
    await expect(page.getByText(/Cleanup verified/)).toBeVisible()
    expect(posts).toHaveLength(5)
  })
}

test('default disabled roster has no cleanup entry and issues no purge request', async ({ page }) => {
  const purge: string[] = []
  await page.route('**/api/**', route => {
    if (route.request().url().includes('/purge')) purge.push(route.request().url())
    return route.fulfill({ json: { roster: [], live_cleanup_targets: [] } })
  })
  await page.goto('/e2e-fixtures/teacher-live-cleanup')
  await page.getByRole('button', { name: 'More actions' }).click()
  await expect(page.getByRole('menuitem', { name: /Clean up live class data/ })).toHaveCount(0)
  expect(purge).toEqual([])
})

test('governed ContentDialog reference across viewport and theme', async ({ page }) => {
  test.setTimeout(90_000)
  for (const viewport of ['desktop', 'mobile']) for (const theme of ['light', 'dark']) {
    await page.setViewportSize(viewport === 'desktop' ? { width: 1440, height: 900 } : { width: 390, height: 844 })
    await page.addInitScript(theme => localStorage.setItem('theme', theme), theme)
    await page.goto('/pattern-lab?role=teacher')
    await page.getByRole('combobox', { name: 'Find a pattern' }).selectOption('controls')
    await page.getByRole('button', { name: 'Open QR example' }).click()
    await expect(page.getByRole('dialog', { name: 'QR sizing example' })).toBeVisible()
    await page.screenshot({ path: `output/playwright/live-cleanup/${viewport}-${theme}-reference.png`, fullPage: false, animations: 'disabled' })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Open QR example' })).toBeFocused()
  }
})
