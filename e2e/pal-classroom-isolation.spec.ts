import type { PalWidgetSnapshot } from '@codepet/pal-widget'
import fixtureSnapshot from './fixtures/pal/snapshot.json'
import { expect, test } from '@playwright/test'

test('classroom switching, reload, logout and stale reward isolation', async ({ page }, testInfo) => {
  const scopeA = `pika-classroom-v1-${'a'.repeat(64)}`
  let delayA = false
  let releaseA: (() => void) | undefined
  let requests = 0
  const tokens: string[] = []
  await page.route('**/api/student/pal/classroom-visit', route => route.fulfill({ json: { status: 'recorded' } }))
  await page.route('**/api/student/pal/read-token', async route => {
    const body = route.request().postDataJSON()
    tokens.push(body.scopeKey)
    await route.fulfill({ json: { token: body.scopeKey,
      scope_key: body.scopeKey, expires_at: new Date(Date.now() + 300_000).toISOString() } })
  })
  await page.route(/\/(api\/v1\/learner\/|assets\/badges\/)/, async route => {
    const asset = new URL(route.request().url()).pathname.split('/').at(-1)
    if (asset === 'badge-checkin-7-day-v1.png' || asset === 'badge-first-classroom-login-v1.png') {
      await route.fulfill({ path: `e2e/fixtures/pal/${asset}`, contentType: 'image/png',
        headers: { 'access-control-allow-origin': '*' } })
      return
    }
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*',
        'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
      return
    }
    const isA = route.request().headers().authorization === `Bearer ${scopeA}`
    requests += 1
    if (isA && delayA) await new Promise<void>(resolve => { releaseA = resolve })
    const snapshot = structuredClone(fixtureSnapshot) as PalWidgetSnapshot
    snapshot.roadmap.semesterLabel = isA ? 'Class A progress' : 'Class B progress'
    snapshot.roadmap.weeks[0].label = snapshot.roadmap.semesterLabel
    snapshot.companion.name = isA ? 'Class A companion' : 'Class B companion'
    snapshot.companion.xp = isA ? 230 : 10
    // Existing locked-companion fixture. Its two pinned badge images are local;
    // no real provider or remote asset request leaves this browser contract.
    if (isA && delayA) snapshot.rewards = [{ id: 'old-a-reward', title: 'Old A reward', description: 'A only' }]
    await route.fulfill({ json: snapshot, headers: { 'access-control-allow-origin': '*' } }).catch(() => undefined)
  })
  const theme = testInfo.project.metadata.theme ?? 'light'
  await page.addInitScript(theme => localStorage.setItem('theme', String(theme)), theme)
  await page.goto('/e2e-fixtures/pal-classroom')
  await expect(page.getByText('Class A progress', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Switch classroom' }).click()
  await expect(page.getByText('Class B progress', { exact: true })).toBeVisible()
  await expect(page.getByText('Class A progress', { exact: true })).toHaveCount(0)
  expect(tokens).toContain(scopeA)
  expect(tokens).toContain(`pika-classroom-v1-${'b'.repeat(64)}`)
  await page.screenshot({ path: `output/playwright/pal-phase2/${testInfo.project.name}-class-b.png`, fullPage: true, animations: 'disabled' })
  delayA = true
  await page.getByRole('button', { name: 'Switch classroom' }).click()
  await expect.poll(() => Boolean(releaseA)).toBe(true)
  await page.getByRole('button', { name: 'Switch classroom' }).click()
  await expect(page.getByText('Class B progress', { exact: true })).toBeVisible()
  releaseA?.()
  await expect(page.getByText('Old A reward', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Class A progress', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('heading', { name: 'Signed out' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Achievement trail' })).toHaveCount(0)
  await expect(page.getByText('Old A reward', { exact: true })).toHaveCount(0)
  delayA = false
  await page.reload()
  await expect(page.getByText('Class A progress', { exact: true })).toBeVisible()
  expect(requests).toBeGreaterThan(2)
})

test('membership revocation clears pending rewards and retains academic draft state', async ({ page }, testInfo) => {
  let state: 'active' | 'reward' | 'revoked' = 'active'
  let releaseSeen: (() => void) | undefined
  let providerRequests = 0
  await page.route('**/api/student/pal/classroom-visit', route => route.fulfill({ json: { status: 'recorded' } }))
  await page.route('**/api/student/pal/read-token', route => {
    const body = route.request().postDataJSON()
    return route.fulfill({ json: { token: body.scopeKey, scope_key: body.scopeKey,
      expires_at: new Date(Date.now() + 300_000).toISOString() } })
  })
  await page.route(/\/(api\/v1\/learner\/|assets\/badges\/)/, async route => {
    const url = new URL(route.request().url())
    const asset = url.pathname.split('/').at(-1)
    if (asset === 'badge-checkin-7-day-v1.png' || asset === 'badge-first-classroom-login-v1.png') {
      return route.fulfill({ path: `e2e/fixtures/pal/${asset}`, contentType: 'image/png' })
    }
    providerRequests += 1
    if (url.pathname.endsWith('/seen')) {
      await new Promise<void>(resolve => { releaseSeen = resolve })
      await route.fulfill({ json: {} }).catch(() => undefined)
      return
    }
    if (state === 'revoked') return route.fulfill({ status: 403, json: { error: 'Membership unavailable' } })
    const snapshot = structuredClone(fixtureSnapshot) as PalWidgetSnapshot
    snapshot.roadmap.weeks[0].label = 'Current classroom progress'
    snapshot.rewards = state === 'reward' ? [{ id: 'revoked-reward', title: 'Pending classroom reward', description: 'Synthetic reward' }] : []
    return route.fulfill({ json: snapshot })
  })
  await page.addInitScript(theme => localStorage.setItem('theme', String(theme)), testInfo.project.metadata.theme ?? 'light')
  await page.goto('/e2e-fixtures/pal-classroom')
  await expect(page.getByText('Current classroom progress', { exact: true })).toBeVisible()
  const draft = page.getByRole('textbox', { name: 'Academic draft' })
  await draft.fill('Keep my unsaved work')
  await page.screenshot({ path: `output/playwright/pal-phase3/${testInfo.project.name}-active.png`, fullPage: true, animations: 'disabled' })
  const refresh = () => page.evaluate(() => window.dispatchEvent(new CustomEvent('pika:pal-refresh', {
    detail: { classroomId: 'c1690000-0000-4000-8000-000000000010' },
  })))
  state = 'reward'
  await refresh()
  await expect(page.getByRole('dialog', { name: 'Reward earned' })).toBeVisible()
  await page.screenshot({ path: `output/playwright/pal-phase3/${testInfo.project.name}-reward.png`, fullPage: true, animations: 'disabled' })
  await page.keyboard.press('Escape')
  await expect.poll(() => Boolean(releaseSeen)).toBe(true)
  state = 'revoked'
  await refresh()
  await expect(page.getByRole('dialog', { name: 'Reward earned' })).toHaveCount(0)
  await expect(page.getByText('Current classroom progress', { exact: true })).toHaveCount(0)
  await expect(draft).toHaveValue('Keep my unsaved work')
  await draft.focus()
  await expect(draft).toBeFocused()
  releaseSeen?.()
  const callsAfterRevocation = providerRequests
  await refresh()
  await expect(page.getByText('Pending classroom reward', { exact: true })).toHaveCount(0)
  expect(providerRequests).toBe(callsAfterRevocation)
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false)
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
  await page.screenshot({ path: `output/playwright/pal-phase3/${testInfo.project.name}-revoked.png`, fullPage: true, animations: 'disabled' })
})

for (const role of ['teacher', 'student'] as const) {
  test.describe(`${role} ordinary classroom regression`, () => {
    test.use({ storageState: `.auth/${role}.json` })
    test('retains the classroom shell with rollout disabled', async ({ page }, testInfo) => {
      let tokenRequests = 0
      await page.route('**/api/student/pal/read-token', route => {
        tokenRequests += 1
        return route.fulfill({ status: 503, json: { error: 'No live provider in browser verification' } })
      })
      await page.addInitScript(theme => localStorage.setItem('theme', String(theme)), testInfo.project.metadata.theme ?? 'light')
      const response = await page.request.get(`/api/${role}/classrooms`)
      expect(response.ok()).toBe(true)
      const payload = await response.json() as { classrooms: Array<{ id: string; title: string }> }
      const classroom = payload.classrooms.find(row => row.title === 'Test Classroom')
      expect(classroom).toBeTruthy()
      await page.goto(`/classrooms/${classroom!.id}?tab=${role === 'teacher' ? 'daily' : 'today'}`)
      await expect(page.getByRole('main').first()).toBeVisible()
      await page.waitForLoadState('networkidle')
      await expect(page.getByText('Refreshing calendar information', { exact: true })).toHaveCount(0)
      await expect(page.getByRole('region', { name: 'Achievement trail' })).toHaveCount(0)
      expect(tokenRequests).toBe(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false)
      await page.screenshot({ path: `output/playwright/pal-phase2/${testInfo.project.name}-${role}-disabled.png`, fullPage: true, animations: 'disabled' })
    })
  })
}
