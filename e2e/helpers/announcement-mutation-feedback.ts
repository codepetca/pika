import { expect, type Locator, type Page, type Route, type TestInfo } from '@playwright/test'
import type { Announcement } from '../../src/types'
import { mockTableShellReads, TABLE_CLASSROOM_ID } from './teacher-student-tables'

async function nativeTabTo(page: Page, target: Locator) {
  for (let index = 0; index < 80; index += 1) {
    if (await target.evaluate(element => document.activeElement === element)) return
    await page.keyboard.press('Tab')
  }
  throw new Error('Native keyboard did not reach Announcement control')
}

async function capture(page: Page, info: TestInfo, name: string) {
  await expect(page.locator('.workspace-entry:visible').first()).toHaveCSS('opacity', '1')
  await expect(page.locator('[data-modal-state="closing"]')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath(`announcement-${name}.png`), animations: 'allow' })
}

/** Actual classroom owners with synthetic responses; all writes intercepted, no clocks changed. */
export async function verifyAnnouncementMutationFeedback(page: Page, info: TestInfo) {
  const mobile = info.project.metadata.viewport === 'mobile'
  const errors: string[] = []
  page.on('pageerror', error => {
    errors.push(error.message)
    void info.attach('announcement-page-error', { body: error.stack || error.message, contentType: 'text/plain' })
  })
  const unit: Announcement = {
    id: '30000000-0000-4000-8000-000000000041', classroom_id: TABLE_CLASSROOM_ID,
    title: 'Unit update', content: 'Bring [your notes](https://example.invalid/notes) for our next discussion.',
    created_by: '30000000-0000-4000-8000-000000000012', is_draft: false,
    published_at: '2026-10-05T12:00:00Z', scheduled_for: null,
    created_at: '2026-10-05T12:00:00Z', updated_at: '2026-10-05T12:00:00Z',
  }
  let announcements = [unit]
  const writes: Route[] = []
  await mockTableShellReads(page, 'teacher')
  const teacherRoute = /\/api\/teacher\/classrooms\/[^/]+\/announcements(?:\/[^?]*)?$/
  await page.route(teacherRoute, async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { announcements } })
    writes.push(route)
  })
  await page.goto('/e2e-fixtures/teacher-student-tables?role=teacher&tab=announcements')
  const reducedMotion = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  expect(reducedMotion).toBe(info.titlePath.includes('reduce'))
  await expect(page.getByText('Unit update', { exact: true })).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  const captureFacts: unknown[] = []
  await capture(page, info, 'teacher-list')

  // Cancellation retires editor feedback, while the original request still settles.
  await page.getByRole('button', { name: 'Create announcement', exact: true }).click()
  const cancelledCreate = page.getByRole('textbox', { name: 'Announcement body', exact: true })
  await cancelledCreate.fill('Cancelled creation body')
  const cancelledPostBefore = writes.length
  await page.getByRole('button', { name: 'Post', exact: true }).click()
  await expect.poll(() => writes.length).toBe(cancelledPostBefore + 1)
  await expect(cancelledCreate).toBeDisabled()
  await nativeTabTo(page, page.getByRole('button', { name: 'Cancel', exact: true }))
  await page.keyboard.press('Enter')
  await expect(cancelledCreate).toHaveCount(0)
  await writes[cancelledPostBefore].fulfill({ status: 503, json: { error: 'Fixture cancelled write' } })
  await expect(page.getByText('Cancelled creation body', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Create announcement', exact: true }).click()
  await expect(cancelledCreate).toBeEnabled()
  await expect(cancelledCreate).toHaveValue('')
  await expect(page.locator('main').last().getByRole('alert')).toHaveCount(0)
  await cancelledCreate.fill('Fresh creation draft')
  await expect(page.getByRole('button', { name: 'Post', exact: true })).toBeEnabled()
  expect(writes.length).toBe(cancelledPostBefore + 1)
  await capture(page, info, 'teacher-cancelled-post')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()

  await page.getByText('Unit update', { exact: true }).click()
  const cancelledEdit = page.getByRole('textbox', { name: 'Edit announcement body', exact: true })
  await cancelledEdit.fill('Cancelled edit body')
  const cancelledPatchBefore = writes.length
  await page.getByRole('button', { name: 'Post', exact: true }).click()
  await expect.poll(() => writes.length).toBe(cancelledPatchBefore + 1)
  await expect(cancelledEdit).toBeDisabled()
  await nativeTabTo(page, page.getByRole('button', { name: 'Cancel', exact: true }))
  await page.keyboard.press('Enter')
  await expect(cancelledEdit).toHaveCount(0)
  await writes[cancelledPatchBefore].fulfill({ status: 503, json: { error: 'Fixture cancelled edit' } })
  await expect(page.getByText('Cancelled edit body', { exact: true })).toHaveCount(0)
  await page.getByText('Unit update', { exact: true }).click()
  await expect(cancelledEdit).toBeEnabled()
  await expect(cancelledEdit).toHaveValue(unit.content)
  await expect(page.locator('main').last().getByRole('alert')).toHaveCount(0)
  await cancelledEdit.fill('Fresh edit draft')
  await expect(page.getByRole('button', { name: 'Post', exact: true })).toBeEnabled()
  expect(writes.length).toBe(cancelledPatchBefore + 1)
  await capture(page, info, 'teacher-cancelled-patch')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  captureFacts.push({ cancelledSessions: ['POST', 'PATCH'], explicitWrites: 2, rollbackSettled: true, freshControlsEnabled: true, noStaleFeedback: true })

  for (const mode of ['publish', 'draft', 'schedule'] as const) {
    await page.getByRole('button', { name: 'Create announcement', exact: true }).click()
    await page.getByPlaceholder('Title (optional)').fill(`Retained ${mode}`)
    const body = page.getByRole('textbox', { name: 'Announcement body', exact: true })
    await body.fill(`Retained ${mode} body`)
    const originalBody = await body.elementHandle()
    await body.evaluate((element: HTMLTextAreaElement) => { element.style.height = '210px'; element.setSelectionRange(3, 3) })
    const baseline = await body.evaluate((element: HTMLTextAreaElement) => ({ height: element.style.height, caret: element.selectionStart, scrollTop: element.scrollTop }))
    const before = writes.length
    const submit = async () => {
      if (mode === 'draft') {
        await page.getByRole('button', { name: 'Choose announcement action', exact: true }).click()
        await nativeTabTo(page, page.getByRole('menuitem', { name: 'Save draft', exact: true }))
        await page.keyboard.press('Enter')
      } else {
        const action = page.getByRole('button', { name: mode === 'schedule' ? 'Schedule' : 'Post', exact: true })
        await nativeTabTo(page, action)
        await page.keyboard.press('Enter')
      }
    }
    if (mode === 'schedule') {
      await page.getByRole('button', { name: 'Choose announcement action', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Schedule...', exact: true }).click()
      await page.getByLabel('Date (Toronto)', { exact: true }).fill('2099-06-15')
      await page.getByLabel('Time (Toronto)', { exact: true }).fill('09:45')
      await page.getByRole('button', { name: 'Done', exact: true }).click()
    }
    await submit()
    await expect.poll(() => writes.length).toBe(before + 1)
    await expect(body).toBeDisabled()
    await capture(page, info, `${mode}-pending`)
    await page.getByRole('link', { name: 'your notes', exact: true }).focus()
    const focused = await page.getByRole('link', { name: 'your notes', exact: true }).elementHandle()
    const scrollBefore = await page.evaluate(() => scrollY)
    const anchorBefore = await focused!.evaluate(element => element.getBoundingClientRect().top)
    await writes[before].fulfill({ status: 503, json: { error: 'Fixture unconfirmed write' } })
    const alert = page.locator('main').last().getByRole('alert').filter({ hasText: 'Pika could not confirm' })
    await expect(alert).toContainText(mode === 'publish' ? 'posting' : mode === 'draft' ? 'saving this draft' : 'scheduling')
    await expect(body).toBeEnabled()
    await expect(body).toHaveValue(`Retained ${mode} body`)
    await expect(page.getByPlaceholder('Title (optional)')).toHaveValue(`Retained ${mode}`)
    expect(await originalBody!.evaluate(element => element.isConnected)).toBe(true)
    expect(await body.evaluate((element: HTMLTextAreaElement) => ({ height: element.style.height, caret: element.selectionStart, scrollTop: element.scrollTop }))).toEqual(baseline)
    expect(await focused!.evaluate(element => element === document.activeElement)).toBe(true)
    const scrollAfter = await page.evaluate(() => scrollY)
    // Existing rollback removes an optimistic row; feedback also changes geometry.
    // Record window/anchor movement, while asserting retained focus and editor state.
    const anchorAfter = await focused!.evaluate(element => element.getBoundingClientRect().top)
    expect(writes.length).toBe(before + 1)
    await alert.scrollIntoViewIfNeeded()
    await capture(page, info, `${mode}-failed`)
    await submit()
    await expect.poll(() => writes.length).toBe(before + 2)
    const payload = writes[before + 1].request().postDataJSON() as { title: string; content: string; is_draft?: boolean; scheduled_for?: string }
    expect(payload.title).toBe(`Retained ${mode}`)
    expect(payload.content).toBe(`Retained ${mode} body`)
    expect(Boolean(payload.is_draft)).toBe(mode === 'draft')
    expect(Boolean(payload.scheduled_for)).toBe(mode === 'schedule')
    const created = { ...unit, ...payload, id: `30000000-0000-4000-8000-${String(42 + announcements.length).padStart(12, '0')}`,
      is_draft: mode === 'draft', scheduled_for: payload.scheduled_for ?? null,
      published_at: mode === 'draft' ? null : payload.scheduled_for ?? new Date().toISOString(),
      created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
    announcements = [created, ...announcements]
    await writes[before + 1].fulfill({ status: 201, json: { announcement: created } })
    await expect(body).toHaveCount(0)
    await expect(alert).toHaveCount(0)
    await expect(page.getByText(`Retained ${mode}`, { exact: true })).toBeVisible()
    await capture(page, info, `${mode}-recovered`)
    captureFacts.push({ mode, explicitWrites: 2, retainedBody: true, caret: baseline.caret, height: baseline.height, failureFocusPreserved: true, editorScrollPreserved: true, scrollBefore, scrollAfter, anchorBefore, anchorAfter })
  }

  await page.getByText('Retained publish body', { exact: true }).click()
  const edit = page.getByRole('textbox', { name: 'Edit announcement body', exact: true })
  const originalEdit = await edit.elementHandle()
  await edit.fill('Edited announcement body')
  await page.getByPlaceholder('Title (optional)').fill('Edited update')
  await page.getByRole('button', { name: 'Choose announcement action', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Schedule...', exact: true }).click()
  await page.getByLabel('Date (Toronto)', { exact: true }).fill('2099-06-15')
  await page.getByLabel('Time (Toronto)', { exact: true }).fill('09:45')
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  const patchBefore = writes.length
  await nativeTabTo(page, page.getByRole('button', { name: 'Save', exact: true }))
  await page.keyboard.press('Enter')
  await expect.poll(() => writes.length).toBe(patchBefore + 1)
  await writes[patchBefore].abort('failed')
  await expect(page.locator('main').last().getByRole('alert')).toContainText('Pika could not confirm saving changes')
  await expect(edit).toHaveValue('Edited announcement body')
  expect(await originalEdit!.evaluate(element => element.isConnected)).toBe(true)
  await page.locator('main').last().getByRole('alert').scrollIntoViewIfNeeded()
  await capture(page, info, 'edit-failed')
  await nativeTabTo(page, page.getByRole('button', { name: 'Save', exact: true }))
  await page.keyboard.press('Enter')
  await expect.poll(() => writes.length).toBe(patchBefore + 2)
  const patch = writes[patchBefore + 1].request().postDataJSON() as Partial<Announcement>
  const index = announcements.findIndex(item => item.title === 'Retained publish')
  const updated = { ...announcements[index], ...patch }
  announcements[index] = updated
  await writes[patchBefore + 1].fulfill({ json: { announcement: updated } })
  await expect(edit).toHaveCount(0)
  await expect(page.locator('main').last().getByRole('alert')).toHaveCount(0)
  await capture(page, info, 'edit-recovered')

  const card = page.locator('div.rounded-lg').filter({ has: page.getByText('Unit update', { exact: true }) }).last()
  await card.getByRole('button', { name: 'Delete announcement', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete announcement?', exact: true })
  await expect(dialog).toContainText('Unit update')
  const deleteBefore = writes.length
  await nativeTabTo(page, dialog.getByRole('button', { name: 'Delete', exact: true }))
  await page.keyboard.press('Enter')
  await expect.poll(() => writes.length).toBe(deleteBefore + 1)
  await writes[deleteBefore].fulfill({ status: 503, json: { error: 'Fixture unconfirmed delete' } })
  await expect(page.locator('main').last().getByRole('alert')).toContainText('Pika could not confirm deleting “Unit update”')
  await expect(dialog).toBeHidden()
  await expect(page.getByText('Unit update', { exact: true })).toBeVisible()
  expect(writes.length).toBe(deleteBefore + 1)
  const retryDelete = page.getByRole('button', { name: 'Retry delete', exact: true })
  await nativeTabTo(page, retryDelete)
  await capture(page, info, 'delete-failed')
  await page.keyboard.press('Enter')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Unit update')
  expect(writes.length).toBe(deleteBefore + 1)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(retryDelete).toBeFocused()
  expect(writes.length).toBe(deleteBefore + 1)
  await page.keyboard.press('Enter')
  await expect(dialog).toBeVisible()
  await capture(page, info, 'delete-reconfirmed')
  await nativeTabTo(page, dialog.getByRole('button', { name: 'Delete', exact: true }))
  await page.keyboard.press('Enter')
  await expect.poll(() => writes.length).toBe(deleteBefore + 2)
  announcements = announcements.filter(item => item.id !== unit.id)
  await writes[deleteBefore + 1].fulfill({ json: { success: true } })
  await expect(dialog).toBeHidden()
  await expect(page.locator('main').last().getByRole('alert')).toHaveCount(0)
  await expect(page.getByText('Unit update', { exact: true })).toHaveCount(0)
  await capture(page, info, 'delete-recovered')
  await page.unroute(teacherRoute)

  await mockTableShellReads(page, 'student')
  await page.route('**/api/student/classrooms/*/gradebook-items', route => route.fulfill({ json: { items: [] } }))
  let ackWrites = 0
  await page.route('**/api/student/classrooms/*/announcements', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { announcements: [unit] } })
    expect(route.request().method()).toBe('POST')
    ackWrites += 1
    return route.fulfill({ status: ackWrites === 1 ? 503 : 200, json: { success: ackWrites !== 1 } })
  })
  await page.goto('/e2e-fixtures/teacher-student-tables?role=student&tab=announcements')
  await expect(page.getByText('Unit update', { exact: true })).toBeVisible()
  await expect(page.locator('main').last().getByRole('alert')).toContainText('could not mark them as read')
  await expect(page.getByRole('button', { name: 'Create announcement', exact: true })).toHaveCount(0)
  await capture(page, info, 'student-acknowledgement-failed')
  await nativeTabTo(page, page.getByRole('button', { name: 'Retry', exact: true }))
  await page.keyboard.press('Enter')
  await expect(page.locator('main').last().getByRole('alert')).toHaveCount(0)
  expect(ackWrites).toBe(2)
  await capture(page, info, 'student-recovered')
  const retainedStudentAnnouncement = await page.getByText('Unit update', { exact: true }).elementHandle()
  if (mobile) await page.getByRole('button', { name: 'Open classroom navigation', exact: true }).click()
  await page.getByRole('link', { name: 'Classwork', exact: true }).click()
  if (mobile) await expect(page.getByRole('dialog', { name: 'Navigation menu' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Classwork', exact: true })).toBeVisible()
  if (mobile) await page.getByRole('button', { name: 'Open classroom navigation', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Classwork', exact: true })).toHaveAttribute('aria-current', 'page')
  await page.getByRole('link', { name: 'Announcements', exact: true }).click()
  if (mobile) await expect(page.getByRole('dialog', { name: 'Navigation menu' })).toHaveCount(0)
  await expect(page.getByText('Unit update', { exact: true })).toBeVisible()
  expect(await retainedStudentAnnouncement!.evaluate(element => element.isConnected)).toBe(true)
  expect(ackWrites).toBe(2)
  expect(errors).toEqual([])
  await info.attach('announcement-feedback-receipt', { body: JSON.stringify({ reducedMotion, captureFacts, teacherWrites: writes.map(route => route.request().method()), studentAcknowledgementWrites: ackWrites, retainedStudentAnnouncement: true, errors }), contentType: 'application/json' })
}
