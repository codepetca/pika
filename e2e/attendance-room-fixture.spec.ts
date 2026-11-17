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
