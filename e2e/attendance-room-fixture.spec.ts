import { test, expect } from '@playwright/test'

const roomId = 'room1234567890123456'
const classId = '30000000-0000-4000-8000-000000000001'
const list = { ok: true, rooms: [{ room_id: roomId, label: 'Room 101', can_manage: true, paired: true }, { room_id: 'other123456789012345', label: 'Room 102', can_manage: true, paired: true }], default_room_id: roomId, meeting: { room_id: 'other123456789012345', revision: 3, accepting_until: null } }

test('mocked teacher room dialog and move picker', async ({ page }) => {
  let meetingRoomId = list.rooms[1].room_id
  let failNextList = false
  await page.route('**/api/teacher/attendance/rooms', async route => {
    const body = route.request().postDataJSON()
    if (body.operation === 'move') meetingRoomId = body.room_id
    if (body.operation === 'undo') {
      meetingRoomId = list.rooms[1].room_id
      failNextList = true
    }
    if (body.operation === 'list' && failNextList) {
      failNextList = false
      await route.fulfill({ status: 503, json: { error: 'Room attendance is temporarily unavailable' } })
      return
    }
    const response = body.operation === 'list'
      ? { ...list, meeting: { ...list.meeting, room_id: meetingRoomId } }
      : body.operation === 'move' ? { ok: true, revision: 4 } : { ok: true }
    await route.fulfill({ json: response })
  })
  await page.goto('/e2e-fixtures/attendance-room')
  const dialog = page.getByRole('dialog', { name: 'Attendance rooms' })
  const defaultPicker = dialog.getByRole('combobox', { name: 'Default room' })
  const meetingPicker = dialog.getByRole('combobox', { name: 'This meeting' })
  await expect(defaultPicker).toHaveValue(roomId)
  await expect(meetingPicker).toHaveValue(list.rooms[1].room_id)
  await expect(dialog.getByLabel('Teacher room sticker')).toBeVisible()
  await page.screenshot({ path: '/tmp/pika-room-fixture-teacher-desktop.png', fullPage: true })
  await meetingPicker.selectOption(roomId)
  const undo = dialog.getByRole('button', { name: 'Undo move' })
  await expect(undo).toBeEnabled()
  await expect(meetingPicker).toHaveValue(roomId)
  await expect(defaultPicker).toHaveValue(roomId)
  await undo.click()
  await expect(dialog.getByRole('alert')).toContainText('Room attendance is temporarily unavailable')
  await expect(meetingPicker).toHaveCount(0)
  await page.screenshot({ path: '/tmp/pika-room-direct-refresh.png', fullPage: true })
  await dialog.getByRole('button', { name: 'Refresh rooms' }).click()
  await expect(meetingPicker).toHaveValue(list.rooms[1].room_id)
  await page.route('**/api/teacher/classrooms', route => route.fulfill({ json: { classrooms: [{ id: classId, title: 'Biology 11' }] } }))
  await page.route('**/api/teacher/attendance/session?**', route => route.fulfill({ json: { session: { state: 'open' } } }))
  await page.goto('/e2e-fixtures/attendance-room?view=move')
  await expect(page.getByRole('button', { name: 'Move Biology 11 here' })).toBeVisible()
  await page.screenshot({ path: '/tmp/pika-room-fixture-move-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: '/tmp/pika-room-fixture-move-mobile.png', fullPage: true })
  await page.getByRole('button', { name: 'Move Biology 11 here' }).click()
  await expect(page.getByRole('button', { name: 'Undo move' })).toBeVisible()
})

test('saving None clears the default without moving the current meeting', async ({ page }) => {
  const currentRoomId = list.rooms[1].room_id
  let defaultRoomId: string | null = roomId
  const mutations: unknown[] = []
  await page.route('**/api/teacher/attendance/rooms', async route => {
    const body = route.request().postDataJSON()
    if (body.operation === 'list') {
      await route.fulfill({ json: { ...list, default_room_id: defaultRoomId } })
    } else {
      mutations.push({ operation: body.operation, room_id: body.room_id })
      if (body.operation === 'default') defaultRoomId = body.room_id
      await route.fulfill({ json: { ok: true } })
    }
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/e2e-fixtures/attendance-room')
  const dialog = page.getByRole('dialog', { name: 'Attendance rooms' })
  const room = dialog.getByRole('combobox', { name: 'Default room' })
  const meeting = dialog.getByRole('combobox', { name: 'This meeting' })
  const save = dialog.getByRole('button', { name: 'Save default' })
  await expect(room).toHaveValue(roomId)
  await room.focus()
  await expect(room).toBeFocused()
  await page.screenshot({ path: '/tmp/pika-room-default-mobile-dark.png', fullPage: true })
  await room.selectOption({ label: 'None' })
  await expect(meeting).toHaveValue(currentRoomId)
  expect(mutations).toEqual([])
  await save.click()
  await expect(save).toBeDisabled()
  await expect(room).toBeEnabled()
  expect(mutations).toEqual([{ operation: 'default', room_id: null }])
  await page.screenshot({ path: '/tmp/pika-room-none-mobile-dark.png', fullPage: true })

  await page.reload()
  await expect(room).toHaveValue('')
  await expect(meeting).toHaveValue(currentRoomId)
  await expect(save).toBeDisabled()
  await room.selectOption(currentRoomId)
  await save.click()
  await expect(save).toBeDisabled()
  await expect(room).toBeEnabled()
  expect(mutations).toEqual([
    { operation: 'default', room_id: null },
    { operation: 'default', room_id: currentRoomId },
  ])
})

test('mocked student result on mobile', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  await page.route('**/api/student/attendance/room-check-in', route => route.fulfill({ json: { results: [{ state: 'needs_staff', title: 'Ask your teacher for help', description: 'Your attendance could not be confirmed.', classroomName: 'Biology 11' }] } }))
  await page.goto('/e2e-fixtures/attendance-room?view=student')
  await expect(page.getByRole('heading', { name: 'Ask your teacher for help' })).toBeVisible()
  await page.screenshot({ path: '/tmp/pika-room-fixture-student-mobile.png', fullPage: true })
  await context.close()
})


test('mocked two-class check-in on mobile', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  await page.clock.setFixedTime(new Date('2026-11-13T15:00:00.000Z'))
  const confirmation = { state: 'checked_in', title: 'Checked in', description: 'Attendance recorded', attendanceStatus: 'present', recordedAt: '2026-11-13T15:00:00.000Z', studentId: '30000000-0000-4000-8000-000000000004', occurrenceBinding: 'a'.repeat(32), classDate: '2026-11-13', serverNow: '2026-11-13T15:00:00.000Z', validUntil: '2026-11-13T16:00:00.000Z' }
  await page.route('**/api/student/attendance/room-check-in', route => route.fulfill({ json: { results: [
    { ...confirmation, classroomId: classId, classroomName: 'Biology 11' },
    { ...confirmation, classroomId: '30000000-0000-4000-8000-000000000005', classroomName: 'Health 11', occurrenceBinding: 'b'.repeat(32) },
  ] } }))
  await page.goto('/e2e-fixtures/attendance-room?view=student')
  await expect(page.getByText('Biology 11')).toBeVisible()
  await expect(page.getByText('Health 11')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Checked in' })).toHaveCount(2)
  await page.screenshot({ path: '/tmp/pika-room-fixture-student-two-classes-mobile.png', fullPage: true })
  await context.close()
})


test('closed student room never calls check-in', async ({ page }) => {
  let calls = 0
  await page.route('**/api/student/attendance/room-check-in', async route => { calls++; await route.abort() })
  await page.goto('/e2e-fixtures/attendance-room?view=closed')
  await expect(page.getByRole('heading', { name: 'Check-in is closed' })).toBeVisible()
  await page.screenshot({ path: '/tmp/pika-room-closed-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: '/tmp/pika-room-closed-mobile.png', fullPage: true })
  expect(calls).toBe(0)
})


test('shared catalog offers ready rooms without room administration', async ({ page }) => {
  await page.route('**/api/teacher/attendance/rooms', async route => {
    const body = route.request().postDataJSON()
    await route.fulfill({ json: body.operation === 'list' ? { ...list, shared_catalog: true, rooms: [
      { ...list.rooms[0], paired: false, attendance_ready: true },
      { ...list.rooms[1], selectable: false },
    ] } : { ok: true, revision: 4 } })
  })
  await page.goto('/e2e-fixtures/attendance-room')
  const dialog = page.getByRole('dialog', { name: 'Attendance rooms' })
  await expect(dialog.getByRole('option', { name: 'Room 101' }).first()).toBeEnabled()
  await expect(dialog.getByRole('option', { name: 'Room 102' }).first()).toBeDisabled()
  await expect(dialog.getByRole('button', { name: 'Create room' })).toHaveCount(0)
  await page.screenshot({ path: '/tmp/pika-shared-room-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: '/tmp/pika-shared-room-mobile.png', fullPage: true })
})

test('poster asks before sending student attendance', async ({ page }) => {
  let calls = 0
  await page.route('**/api/student/attendance/room-check-in', route => { calls++; return route.fulfill({ json: { results: [] } }) })
  await page.goto('/e2e-fixtures/attendance-room?view=poster')
  await expect(page.getByRole('button', { name: 'Check in', exact: true })).toBeVisible()
  expect(calls).toBe(0)
  await page.screenshot({ path: '/tmp/pika-poster-confirm-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: '/tmp/pika-poster-confirm-mobile.png', fullPage: true })
  await page.getByRole('button', { name: 'Check in', exact: true }).click()
  await expect.poll(() => calls).toBe(1)
})


test('Daily schedules combine meeting rooms, poster and sticker controls', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  await page.clock.setFixedTime(new Date('2026-11-13T15:00:00Z'))
  await page.addInitScript(() => { window.print = () => { (window as Window & { printed?: boolean }).printed = true } })
  const other = list.rooms[1].room_id
  const unavailable = 'unready1234567890123'
  const requests: Array<Record<string, unknown>> = []
  let meeting = other
  let releaseMove!: () => void
  const movePending = new Promise<void>(resolve => { releaseMove = resolve })
  const policy = { classroomId: classId, timezone: 'America/Toronto', sessionStartsLocal: '09:00', sessionEndsLocal: '10:00', sessionEndDayOffset: 0, entryOpensMinutesBefore: 10, presentGraceMinutes: 5, entryClosesMinutesBeforeEnd: 10, absentMinutesBeforeEnd: 0, enabled: true, revision: 1, updatedAt: '2026-11-13T12:00:00Z' }
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url())
    let body: unknown = {}
    let status = 200
    if (url.pathname.endsWith('/class-days')) body = { class_days: [{ id: 'day-1', classroom_id: classId, date: '2026-11-13', prompt_text: null, is_class_day: true }] }
    else if (url.pathname === '/api/teacher/attendance/policy') body = { policy }
    else if (url.pathname === '/api/teacher/attendance/schedules') body = { schedules: [{ id: null, name: 'Regular schedule', policy }], selectedId: null }
    else if (url.pathname === '/api/teacher/attendance/session') body = { classroomId: classId, classDate: '2026-11-13', integration: 'ready', session: { state: 'not_scheduled', opensAt: null, closesAt: null, sessionStartsAt: null, sessionEndsAt: null, presentThroughAt: null, absentAt: null, revision: null, pendingCommand: false, commandFailed: false }, sync: { state: 'current', confirmedAt: null }, students: [] }
    else if (url.pathname === '/api/teacher/logs') body = { logs: [] }
    else if (url.pathname === '/api/teacher/log-summary') body = { summary_status: 'no_logs', summary: null }
    else if (url.pathname === '/api/teacher/attendance/rooms') {
      const request = route.request().postDataJSON() as Record<string, unknown>
      requests.push(request)
      if (request.operation === 'move') { await movePending; meeting = String(request.room_id); body = { revision: 4 } }
      else if (request.operation === 'undo') { meeting = other; body = { ok: true } }
      else if (request.operation === 'poster') body = { label: 'Room 102', student_poster_url: `https://bara.example/rooms/${other}/scan?poster=${'a'.repeat(40)}` }
      else body = { ...list, shared_catalog: true, meeting: { ...list.meeting, room_id: meeting }, rooms: [...list.rooms, { room_id: unavailable, label: 'Room 103', paired: false, can_manage: false }] }
    } else { status = 404; body = { error: 'Fixture route unavailable' } }
    await route.fulfill({ status, json: body })
  })
  await page.goto('/e2e-fixtures/teacher-daily-attendance?rooms=on', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'More actions' }).click()
  await expect(page.getByRole('menuitem', { name: 'Attendance rooms' })).toHaveCount(0)
  await page.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('button', { name: 'Attendance hours, 9:00 AM to 10:00 AM' }).click()
  const dialog = page.getByRole('dialog', { name: 'Attendance schedules' })
  const meetingPicker = dialog.getByRole('combobox', { name: 'This meeting' })
  const defaultPicker = dialog.getByRole('combobox', { name: 'Default room' })
  await expect(meetingPicker).toHaveValue(other)
  await expect(defaultPicker).toHaveValue(roomId)
  await expect(dialog.getByRole('option', { name: 'Room 103 (unpaired)' }).first()).toBeDisabled()
  for (const [size, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]] as const) {
    await page.setViewportSize(viewport)
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate(value => { document.documentElement.classList.toggle('dark', value === 'dark'); document.documentElement.style.colorScheme = value }, theme)
      await dialog.getByRole('radio', { name: /Regular schedule/ }).scrollIntoViewIfNeeded()
      await page.screenshot({ path: testInfo.outputPath(`schedules-${size}-${theme}.png`), animations: 'disabled' })
      await dialog.getByLabel('Teacher room sticker').scrollIntoViewIfNeeded()
      await page.screenshot({ path: testInfo.outputPath(`rooms-${size}-${theme}.png`), animations: 'disabled' })
      await dialog.getByRole('button', { name: 'Apply schedule' }).scrollIntoViewIfNeeded()
      await page.screenshot({ path: testInfo.outputPath(`footer-${size}-${theme}.png`), animations: 'disabled' })
    }
  }
  await meetingPicker.selectOption(roomId)
  await expect(dialog.getByText('Moving meeting…')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Apply schedule' })).toBeDisabled()
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  releaseMove()
  await expect(dialog.getByRole('button', { name: 'Undo move' })).toBeEnabled()
  expect(requests.find(request => request.operation === 'move')).not.toHaveProperty('save_default')
  expect(requests.some(request => request.operation === 'default')).toBe(false)
  await defaultPicker.selectOption(other)
  await expect(dialog.getByLabel('Teacher room sticker')).toBeVisible()
  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download sticker' }).click()
  expect((await download).suggestedFilename()).toBe('attendance-room-sticker.svg')
  await dialog.getByRole('button', { name: 'Print student poster' }).click()
  await expect(dialog).toHaveCount(0)
  const poster = page.getByRole('dialog', { name: 'Student attendance poster' })
  await expect(poster.getByLabel('Room 102 check in for attendance QR code')).toBeVisible()
  expect(requests.find(request => request.operation === 'poster')).toMatchObject({ classroom_id: classId, room_id: other })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.screenshot({ path: testInfo.outputPath('poster-desktop.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: testInfo.outputPath('poster-mobile.png'), animations: 'disabled' })
  await poster.getByRole('button', { name: 'QR options' }).click()
  await poster.getByRole('menuitem', { name: 'Print poster' }).click()
  expect(await page.evaluate(() => (window as Window & { printed?: boolean }).printed)).toBe(true)
  await poster.getByRole('button', { name: 'Close' }).click()
  await expect(dialog.getByRole('button', { name: 'Undo move' })).toBeEnabled()
  await expect(defaultPicker).toHaveValue(other)
  await dialog.getByRole('button', { name: 'Undo move' }).click()
  await expect(meetingPicker).toHaveValue(other)
  expect(requests.find(request => request.operation === 'undo')).toMatchObject({ revision: 4 })
})


test('schedules show room loading, error and empty states', async ({ page }, testInfo) => {
  let state: 'loading' | 'error' | 'empty' = 'loading'
  let finishRead!: () => void
  const pending = new Promise<void>(resolve => { finishRead = resolve })
  await page.route('**/api/teacher/attendance/schedules?**', route => route.fulfill({ json: { schedules: [{ id: null, name: 'Regular schedule', policy: null }], selectedId: null } }))
  await page.route('**/api/teacher/attendance/rooms', async route => {
    if (state === 'loading') { await pending; await route.fulfill({ status: 503, json: { error: 'Room attendance is temporarily unavailable' } }); return }
    if (state === 'error') { await route.fulfill({ status: 503, json: { error: 'Room attendance is temporarily unavailable' } }); return }
    await route.fulfill({ json: { shared_catalog: true, rooms: [], default_room_id: null, meeting: null } })
  })
  await page.goto('/e2e-fixtures/attendance-room?view=schedules')
  await expect(page.getByText('Loading rooms…')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('rooms-loading.png'), animations: 'disabled' })
  state = 'error'
  finishRead()
  await expect(page.getByRole('dialog', { name: 'Attendance schedules' }).getByRole('alert')).toContainText('Room attendance is temporarily unavailable')
  await page.screenshot({ path: testInfo.outputPath('rooms-error.png'), animations: 'disabled' })
  state = 'empty'
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Attendance rooms' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Default room' })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('rooms-empty.png'), animations: 'disabled' })
})
