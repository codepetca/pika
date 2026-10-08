import { expect, type CDPSession, type Page, type TestInfo } from '@playwright/test'

/** Native drag inputs with a deterministic fixture parent closing the real owner. */
export async function verifyAssignmentEditorDragShutdown(page: Page, testInfo: TestInfo) {
  const theme = testInfo.project.metadata.theme as 'light' | 'dark'
  const mobile = testInfo.project.metadata.viewport === 'mobile'
  const writes: string[] = []
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript((value) => localStorage.setItem('theme', value), theme)
  await page.addInitScript(() => {
    const proof = window as unknown as { dragProofPhase: string; dragProofFetches: unknown[] }
    proof.dragProofPhase = 'retirement'
    proof.dragProofFetches = []
    const original = window.fetch
    window.fetch = (...args) => {
      if (args[1]?.method && args[1].method !== 'GET') proof.dragProofFetches.push({ phase: proof.dragProofPhase, method: args[1].method, body: args[1].body, at: performance.now() })
      return original(...args)
    }
  })
  await page.route('**/api/**', async (route) => {
    if (route.request().method() !== 'GET') writes.push(route.request().method())
    await route.fulfill({ json: { provenance: null } })
  })
  expect((await page.goto('/e2e-fixtures/teacher-assignment-preview', { waitUntil: 'networkidle' }))?.status()).toBe(200)
  const opener = page.getByRole('button', { name: 'Edit fixture assignment' })
  const evidence: unknown[] = []

  for (const input of ['pending-pointer', 'pointer', 'keyboard', 'keyboard-refresh'] as const) {
    const keyboard = input.startsWith('keyboard')
    await opener.click()
    const owner = page.getByRole('dialog', { name: 'Edit Draft', exact: true })
    await expect(owner.getByRole('textbox', { name: 'Title', exact: true })).toBeFocused()
    // Move away first so readiness proves the refreshed owner's delayed focus ran.
    await owner.getByRole('textbox', { name: 'Title', exact: true }).press('Tab')
    await expect(owner.getByRole('button', { name: 'Preview', exact: true })).toBeFocused()
    await page.evaluate(() => window.dispatchEvent(new Event('pika-assignment-fixture-requirements')))
    const first = owner.getByRole('button', { name: 'Drag to reorder Saved link one', exact: true })
    const second = owner.getByRole('button', { name: 'Drag to reorder Saved link two', exact: true })
    await expect(first).toBeEnabled()
    await expect(owner.getByRole('textbox', { name: 'Title', exact: true })).toBeFocused()
    const root = await owner.evaluateHandle((element) => element.closest<HTMLElement>('[data-modal-state]')!)
    const keys: Array<{ key: string; prevented: boolean }> = []
    const observationName = `fixtureDragKeys${input}`
    await page.exposeFunction(observationName, (key: string, prevented: boolean) => keys.push({ key, prevented }))
    await page.evaluate((name) => {
      document.addEventListener('keydown', (event) => {
        // Native dispatch can run a microtask checkpoint between listeners.
        // Observe after the bubble listeners, including the actual sensor.
        setTimeout(() => { void (window as unknown as Record<string, (key: string, prevented: boolean) => Promise<void>>)[name](event.key, event.defaultPrevented) }, 0)
      }, { capture: true })
    }, observationName)

    let touch: CDPSession | undefined
    const firstBox = (await first.boundingBox())!
    const secondBox = (await second.boundingBox())!
    const x = firstBox.x + firstBox.width / 2
    const y = firstBox.y + firstBox.height / 2
    const targetY = secondBox.y + secondBox.height / 2
    if (keyboard) {
      await first.click()
      await page.keyboard.press('Space')
    } else if (mobile) {
      touch = await page.context().newCDPSession(page)
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] })
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + (input === 'pending-pointer' ? 2 : 10), id: 1 }] })
    } else {
      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.mouse.move(x, y + (input === 'pending-pointer' ? 2 : 10))
    }
    if (input === 'pending-pointer') await expect(first).not.toHaveAttribute('aria-pressed', 'true')
    else await expect(first).toHaveAttribute('aria-pressed', 'true')
    expect(await first.evaluate((button) => button.parentElement?.classList.contains('shadow-lg'))).toBe(input !== 'pending-pointer')
    if (keyboard) {
      await page.keyboard.press('ArrowDown')
      await expect.poll(() => keys.some((key) => key.key === 'ArrowDown' && key.prevented)).toBe(true)
    } else if (input !== 'pending-pointer') {
      if (touch) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: targetY, id: 1 }] })
      else await page.mouse.move(x, targetY, { steps: 4 })
    }
    if (input !== 'pending-pointer') {
      await expect.poll(() => first.evaluate((button) => {
        const transform = button.parentElement?.style.transform
        return transform ? new DOMMatrix(transform).m42 : 0
      })).toBeGreaterThan(6)
    }
    await testInfo.attach(`${input}-active`, { body: await page.screenshot({ animations: 'allow' }), contentType: 'image/png' })
    const active = await first.evaluate((button) => ({ pressed: button.getAttribute('aria-pressed'), transform: button.parentElement?.style.transform }))

    // Models the existing teacher parent's external selection/owner close.
    if (input === 'keyboard-refresh') {
      await page.evaluate(() => window.dispatchEvent(new Event('pika-assignment-fixture-requirements')))
      await expect(first).not.toHaveAttribute('aria-pressed', 'true')
      await expect(owner.getByRole('textbox', { name: 'Title', exact: true })).toBeFocused()
    } else {
      await page.evaluate(() => window.dispatchEvent(new Event('pika-assignment-fixture-close')))
      await expect(owner).toHaveCount(0)
      await expect(opener).toBeFocused()
      expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
    }
    if (touch) {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: targetY + 10, id: 1 }] })
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await touch.detach()
    } else if (!keyboard) {
      await page.mouse.move(x + 10, targetY + 10)
      await page.mouse.up()
    }
    const priorKeys = keys.length
    await page.keyboard.press('ArrowDown')
    await expect.poll(() => keys.length).toBeGreaterThan(priorKeys)
    expect(keys.at(-1)?.key).toBe('ArrowDown')
    expect(keys.at(-1)?.prevented).toBe(false)
    if (keyboard) expect(keys.some((key) => key.key === 'ArrowDown' && key.prevented)).toBe(true)
    if (input === 'keyboard-refresh') {
      await expect(owner).toHaveCount(1)
      await page.evaluate(() => window.dispatchEvent(new Event('pika-assignment-fixture-close')))
    }
    await expect(opener).toBeFocused()
    await expect.poll(() => root.evaluate((element) => element.isConnected)).toBe(false)
    expect(writes).toEqual([])
    expect(errors).toEqual([])
    evidence.push({ input: mobile && input === 'pointer' ? 'native touch' : input, active, keys: [...keys],
      externalClose: 'deterministic fixture parent event; real owner and native sensor input', writes: [...writes], errors: [...errors] })
  }
  // A fresh session still completes genuine keyboard reordering normally.
  await page.evaluate(() => { (window as unknown as { dragProofPhase: string }).dragProofPhase = 'successful-reorder' })
  await opener.click()
  const owner = page.getByRole('dialog', { name: 'Edit Draft', exact: true })
  await expect(owner.getByRole('textbox', { name: 'Title', exact: true })).toBeFocused()
  await owner.getByRole('textbox', { name: 'Title', exact: true }).press('Tab')
  await expect(owner.getByRole('button', { name: 'Preview', exact: true })).toBeFocused()
  await page.evaluate(() => window.dispatchEvent(new Event('pika-assignment-fixture-requirements')))
  await expect(owner.getByRole('textbox', { name: 'Title', exact: true })).toBeFocused()
  await owner.getByRole('button', { name: 'Drag to reorder Saved link one', exact: true }).click()
  await page.keyboard.press('Space')
  await expect(owner.getByRole('button', { name: 'Drag to reorder Saved link one', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => owner.getByRole('button', { name: 'Drag to reorder Saved link one', exact: true }).evaluate((button) => new DOMMatrix(button.parentElement?.style.transform).m42)).toBeGreaterThan(6)
  await page.keyboard.press('Space')
  await expect(owner.getByRole('textbox', { name: 'Link label', exact: true }).first()).toHaveValue('Saved link two')
  // Closing immediately cancels the autosave triggered by the successful reorder.
  await page.evaluate(() => {
    (window as unknown as { dragProofPhase: string }).dragProofPhase = 'closed'
    window.dispatchEvent(new Event('pika-assignment-fixture-close'))
  })
  await expect(opener).toBeFocused()
  await testInfo.attach('fetch-phase-diagnostic', { body: Buffer.from(JSON.stringify(await page.evaluate(() => (window as unknown as { dragProofFetches: unknown[] }).dragProofFetches))), contentType: 'application/json' })
  expect(writes).toEqual([])
  expect(errors).toEqual([])
  await testInfo.attach('drag-shutdown-evidence', { body: Buffer.from(JSON.stringify(evidence)), contentType: 'application/json' })
}

export async function verifyAssignmentEditorControls(page: Page, testInfo: TestInfo) {
  const theme = testInfo.project.metadata.theme as 'light' | 'dark'
  const mobile = testInfo.project.metadata.viewport === 'mobile'
  const writes: Array<{ method: string; path: string }> = []
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript((value) => localStorage.setItem('theme', value), theme)
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    if (request.method() === 'GET') return route.fulfill({ json: { provenance: null } })
    const path = new URL(request.url()).pathname
    writes.push({ method: request.method(), path })
    expect(request.method()).toBe('POST')
    expect(path).toBe('/api/teacher/assignments/30000000-0000-4000-8000-000000000081/release')
    return route.fulfill({ json: { assignment: {
      id: '30000000-0000-4000-8000-000000000081', classroom_id: '30000000-0000-4000-8000-000000000082',
      title: 'Field observations', description: 'Read the field guide.', instructions_markdown: 'Read the field guide.',
      is_draft: false, released_at: '2026-10-01T12:00:00.000Z', due_at: '2026-11-01T04:59:59.000Z',
    } } })
  })
  expect((await page.goto('/e2e-fixtures/teacher-assignment-preview', { waitUntil: 'networkidle' }))?.status()).toBe(200)
  const opener = page.getByRole('button', { name: 'Edit fixture assignment' })
  const owner = page.getByRole('dialog', { name: 'Edit Draft', exact: true })
  for (const control of ['toolbar', 'actions', 'remove', 'preview'] as const) {
    await opener.click()
    await expect(owner.getByRole('textbox', { name: 'Title', exact: true })).toBeFocused()
    if (control === 'toolbar') {
      if (mobile) {
        await owner.getByRole('button', { name: 'Format text as heading' }).press('ArrowDown')
        await expect(page.getByRole('menuitem', { name: 'Heading 1' })).toBeVisible()
      } else {
        await owner.getByRole('button', { name: 'Link', exact: true }).click()
        await expect(page.getByPlaceholder('Paste a link...')).toBeVisible()
      }
    } else if (control === 'actions') {
      const titleBefore = await owner.getByRole('textbox', { name: 'Title', exact: true }).boundingBox()
      await owner.getByRole('button', { name: 'Choose assignment action' }).press('Enter')
      await expect(page.getByRole('menuitem', { name: 'Draft', exact: true })).toBeVisible()
      const panel = (await owner.boundingBox())!
      for (const item of await page.getByRole('menuitem').all()) {
        const box = (await item.boundingBox())!
        expect(box.y).toBeGreaterThanOrEqual(panel.y)
        expect(box.y + box.height).toBeLessThanOrEqual(panel.y + panel.height)
      }
      expect(await owner.getByRole('textbox', { name: 'Title', exact: true }).boundingBox()).toEqual(titleBefore)
    } else if (control === 'remove') {
      await page.evaluate(() => window.dispatchEvent(new Event('pika-assignment-fixture-requirements')))
      await owner.getByRole('button', { name: 'Remove attachment' }).first().click()
      await expect(page.getByRole('dialog', { name: 'Remove attachment?' })).toBeVisible()
    } else {
      await owner.getByRole('button', { name: 'Preview', exact: true }).click()
      await expect(page.getByRole('dialog', { name: 'Instructions', exact: true })).toBeVisible()
    }
    await testInfo.attach(`${control}-open`, { body: await page.screenshot({ animations: 'allow' }), contentType: 'image/png' })
    await page.evaluate(() => window.dispatchEvent(new Event('pika-assignment-fixture-close')))
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(page.getByPlaceholder('Paste a link...')).toHaveCount(0)
    await expect(opener).toBeFocused()
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
    await expect(page.locator('[data-modal-state="closing"]')).toHaveCount(0)
    await expect(opener).toBeFocused()
    expect(writes).toEqual([])
  }
  // The real owner publishes to the fixture parent, which clears its selection.
  await opener.click()
  await expect(owner.getByRole('textbox', { name: 'Title', exact: true })).toBeFocused()
  await owner.getByRole('button', { name: 'Post', exact: true }).click()
  const confirm = page.getByRole('dialog', { name: 'Post assignment to students?' })
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: 'Post', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByTestId('fixture-publications')).toHaveText('1')
  await expect(opener).toBeFocused()
  await expect(page.locator('[data-modal-state="closing"]')).toHaveCount(0)
  expect(writes).toHaveLength(1)
  expect(errors).toEqual([])
  await testInfo.attach('controls-and-parent-publication', { body: Buffer.from(JSON.stringify({ mobile, theme, writes, errors,
    parent: 'Deterministic fixture parent; real AssignmentModal and intercepted release response', controls: ['toolbar', 'actions', 'remove', 'preview'] })), contentType: 'application/json' })
}
