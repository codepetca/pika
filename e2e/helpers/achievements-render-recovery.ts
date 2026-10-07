import { expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import type { PalWidgetSnapshot } from '@codepet/pal-widget'
import fixtureSnapshot from '../fixtures/pal/snapshot.json'

async function keyboardFocus(page: Page, target: Locator) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await target.evaluate(element => element === document.activeElement)) return
    await page.keyboard.press('Tab')
  }
  throw new Error('Keyboard did not reach the roadmap recovery control')
}

async function scrollState(region: Locator) {
  return region.evaluate(element => {
    const ancestors: { tag: string; overflowY: string; scrollTop: number }[] = []
    for (let parent = element.parentElement; parent && parent !== document.body && parent !== document.documentElement; parent = parent.parentElement) {
      const overflowY = getComputedStyle(parent).overflowY
      if (overflowY === 'auto' || overflowY === 'scroll') ancestors.push({ tag: parent.tagName, overflowY, scrollTop: parent.scrollTop })
    }
    return { windowY: window.scrollY, ancestors }
  })
}

async function settleScroll(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => {
    let previous = window.scrollY, stableFrames = 0
    const frame = () => {
      stableFrames = previous === window.scrollY ? stableFrames + 1 : 0
      previous = window.scrollY
      if (stableFrames >= 6) resolve()
      else window.requestAnimationFrame(frame)
    }
    window.requestAnimationFrame(frame)
  }))
}

async function capture(page: Page, info: TestInfo, state: string) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath(`achievements-${state}.png`), animations: 'allow' })
}

/** Actual host recovery, boundary, provider and roadmap with synthetic intercepted traffic. */
export async function verifyAchievementsRenderRecovery(page: Page, info: TestInfo) {
  const expectedFault = 'PIKA_ACHIEVEMENTS_FIXTURE_RENDER_FAILURE'
  const unexpectedErrors: string[] = [], blocked: string[] = [], scopes: string[] = []
  let snapshotReads = 0, expectedErrors = 0
  page.on('pageerror', error => {
    if (error.message === expectedFault) expectedErrors += 1
    else unexpectedErrors.push(error.message)
  })
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.pathname === '/api/student/pal/classroom-visit') return route.fulfill({ json: { status: 'recorded' } })
    if (url.pathname === '/api/student/pal/read-token') {
      const body = request.postDataJSON()
      scopes.push(body.scopeKey)
      return route.fulfill({ json: { token: body.scopeKey, scope_key: body.scopeKey,
        expires_at: new Date(Date.now() + 300_000).toISOString() } })
    }
    const asset = url.pathname.split('/').at(-1)
    if (asset === 'badge-checkin-7-day-v1.png' || asset === 'badge-first-classroom-login-v1.png') {
      return route.fulfill({ path: `e2e/fixtures/pal/${asset}`, contentType: 'image/png',
        headers: { 'access-control-allow-origin': '*' } })
    }
    if (url.pathname.includes('/api/v1/learner/') && request.method() === 'GET') {
      snapshotReads += 1
      const snapshot = structuredClone(fixtureSnapshot) as PalWidgetSnapshot
      snapshot.rewards = []
      snapshot.roadmap.weeks[0].label = request.headers().authorization === `Bearer pika-classroom-v1-${'a'.repeat(64)}`
        ? 'Class A progress' : 'Class B progress'
      return route.fulfill({ json: snapshot, headers: { 'access-control-allow-origin': '*' } })
    }
    if (url.pathname.startsWith('/api/') || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
      blocked.push(`${request.method()} ${url.hostname}${url.pathname}`)
      return route.abort()
    }
    return route.continue()
  })
  await page.goto('/e2e-fixtures/pal-classroom?recovery=true')
  const region = page.getByRole('region', { name: 'Achievements', exact: true })
  const trail = page.getByRole('region', { name: 'Achievement trail', exact: true })
  await expect(trail).toBeVisible()
  await expect(page.getByText('Class A progress', { exact: true })).toBeVisible()
  const draft = page.getByRole('textbox', { name: 'Academic draft', exact: true })
  await draft.fill('Draft survives local render retries')
  const draftNode = await draft.elementHandle(), regionNode = await region.elementHandle()
  if (!draftNode || !regionNode) throw new Error('Actual recovery owner did not mount')
  await settleScroll(page)
  const reducedMotion = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  expect(reducedMotion).toBe(info.titlePath.includes('reduce'))
  const initialReads = snapshotReads, initialScopes = scopes.length
  await capture(page, info, 'healthy')

  await page.getByRole('button', { name: 'Cause roadmap render failure', exact: true }).click()
  const retry = region.getByRole('button', { name: 'Try again', exact: true })
  await expect(retry).toBeVisible()
  await expect(trail).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Cause roadmap render failure', exact: true })).toBeFocused()
  await capture(page, info, 'first-failure')
  await keyboardFocus(page, retry)
  await expect(retry).toBeFocused()
  const target = await retry.boundingBox()
  expect(target?.width).toBeGreaterThanOrEqual(44)
  expect(target?.height).toBeGreaterThanOrEqual(44)
  await capture(page, info, 'retry-focused')
  await retry.press('Enter')
  await expect(region).toBeFocused()
  await expect(retry).toBeVisible()
  expect(await regionNode.evaluate(element => element.isConnected)).toBe(true)
  await keyboardFocus(page, retry)
  await retry.press('Space')
  await expect(region).toBeFocused()
  await expect(retry).toBeVisible()
  await capture(page, info, 'repeated-failure')
  expect(snapshotReads).toBe(initialReads)
  expect(scopes).toHaveLength(initialScopes)
  expect(await draftNode.evaluate(element => element.isConnected)).toBe(true)
  await expect(draft).toHaveValue('Draft survives local render retries')

  await page.getByRole('button', { name: 'Hide roadmap', exact: true }).click()
  await expect(region).toHaveCount(0)
  expect(await regionNode.evaluate(element => element.isConnected)).toBe(true)
  expect(await regionNode.evaluate(element => element.parentElement?.hasAttribute('inert'))).toBe(true)
  await page.getByRole('button', { name: 'Show roadmap', exact: true }).click()
  await expect(retry).toBeVisible()
  await expect(trail).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Hide roadmap', exact: true })).toBeFocused()
  expect(snapshotReads).toBe(initialReads)

  await page.getByRole('button', { name: 'Allow roadmap render', exact: true }).click()
  await expect(retry).toBeVisible()
  await expect(trail).toHaveCount(0)
  await keyboardFocus(page, retry)
  const retryScroll = await scrollState(region)
  const retryTransition = await retry.evaluate(element => ({
    property: getComputedStyle(element).transitionProperty,
    duration: getComputedStyle(element).transitionDuration,
  }))
  const retryNode = await retry.elementHandle()
  await retry.press('Enter')
  await expect(trail).toBeVisible()
  await expect(region).toBeFocused()
  expect(await retryNode!.evaluate(element => element.isConnected)).toBe(false)
  expect(await regionNode.evaluate(element => element.isConnected)).toBe(true)
  await settleScroll(page)
  await expect.poll(() => scrollState(region)).toEqual(retryScroll)
  expect(await region.evaluate(element => getComputedStyle(element).boxShadow)).not.toBe('none')
  await capture(page, info, 'recovered-focused')
  await expect(draft).toHaveValue('Draft survives local render retries')
  expect(snapshotReads).toBe(initialReads)
  expect(scopes).toHaveLength(initialScopes)

  await page.getByRole('button', { name: 'Cause roadmap render failure', exact: true }).click()
  await expect(retry).toBeVisible()
  await page.getByRole('button', { name: 'Switch classroom', exact: true }).click()
  await expect(trail).toBeVisible()
  await expect(page.getByText('Class B progress', { exact: true })).toBeVisible()
  expect(await regionNode.evaluate(element => element.isConnected)).toBe(false)
  expect(snapshotReads).toBeGreaterThan(initialReads)
  expect(scopes).toContain(`pika-classroom-v1-${'b'.repeat(64)}`)
  await capture(page, info, 'scope-b')
  await page.getByRole('button', { name: 'Cause roadmap render failure', exact: true }).click()
  await expect(retry).toBeVisible()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(region).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeFocused()
  await capture(page, info, 'signed-out')
  expect(unexpectedErrors).toEqual([])
  expect(blocked).toEqual([])
  await info.attach('achievements-recovery-receipt', { body: JSON.stringify({
    initialReads, snapshotReads, initialScopes, scopeRequests: scopes.length, retryScroll, reducedMotion, retryTransition,
    expectedContainedFixtureErrors: expectedErrors, unexpectedErrors, blocked,
    nativeEnterAndSpace: true, regionAndDraftRetainedDuringRetry: true,
    hiddenOwnerRetainedWithoutAutomaticRetry: true,
    limits: 'Actual recovery/boundary/provider/roadmap; synthetic intercepted token, visit and snapshot traffic, pinned assets; gated fixture shell rather than authenticated classroom/provider conformance; window and inherited auto/scroll ancestors observed; an empty ancestor list does not prove an internal classroom scroll owner; no hardware or all-video replay claim.',
  }, null, 2), contentType: 'application/json' })
}
