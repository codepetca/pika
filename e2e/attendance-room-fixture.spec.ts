import { test, expect } from '@playwright/test'

const roomId = 'room1234567890123456'
const classId = '30000000-0000-4000-8000-000000000001'
const list = { ok: true, rooms: [{ room_id: roomId, label: 'Room 101', can_manage: true, paired: true }, { room_id: 'other123456789012345', label: 'Room 102', can_manage: true, paired: true }], default_room_id: roomId, meeting: { room_id: 'other123456789012345', revision: 3, accepting_until: null } }

test('mocked teacher room dialog and move picker', async ({ page }) => {
  await page.route('**/api/teacher/attendance/rooms', async route => {
    const body = route.request().postDataJSON()
    await route.fulfill({ json: body.operation === 'list' ? list : body.operation === 'move' ? { ok: true, revision: 4 } : { ok: true } })
  })
  await page.goto('/e2e-fixtures/attendance-room')
  const dialog = page.getByRole('dialog', { name: 'Attendance rooms' })
  await expect(dialog.getByLabel('Room', { exact: true })).toBeVisible()
  await dialog.getByLabel('Room', { exact: true }).selectOption(roomId)
  await expect(dialog.getByLabel('Teacher room sticker')).toBeVisible()
  await page.screenshot({ path: '/tmp/pika-room-fixture-teacher-desktop.png', fullPage: true })
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
