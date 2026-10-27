import userEvent from '@testing-library/user-event'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Suspense, startTransition, useState } from 'react'
import { TeacherAnnouncementsTab } from '@/app/classrooms/[classroomId]/TeacherAnnouncementsTab'
import { TeacherAnnouncementsSection } from '@/app/classrooms/[classroomId]/TeacherAnnouncementsSection'
import { StudentAnnouncementsSection } from '@/app/classrooms/[classroomId]/StudentAnnouncementsSection'
import {
  StudentNotificationsProvider,
  useStudentNotifications,
} from '@/components/StudentNotificationsProvider'
import { invalidateCachedJSONMatching } from '@/lib/request-cache'
import { TooltipProvider } from '@/ui'
import type { Announcement, Classroom } from '@/types'

const classroom: Classroom = {
  id: 'classroom-announcements-markdown',
  teacher_id: 'teacher-1',
  title: 'Announcements Markdown',
  class_code: 'ABC123',
  theme_color: 'blue',
  term_label: null,
  allow_enrollment: true,
  start_date: '2026-02-01',
  end_date: '2026-06-30',
  lesson_plan_visibility: 'current_week',
  source_blueprint_id: null,
  source_blueprint_origin: null,
  actual_site_slug: null,
  actual_site_published: false,
  actual_site_config: {
    overview: true,
    outline: true,
    resources: true,
    assignments: true,
    tests: true,
    lesson_plans: true,
    announcements: true,
    lesson_plan_scope: 'current_week',
  },
  course_overview_markdown: '',
  course_outline_markdown: '',
  archived_at: null,
  created_at: '2026-05-13T00:00:00.000Z',
  updated_at: '2026-05-13T00:00:00.000Z',
}

const markdownAnnouncement: Announcement = {
  id: 'announcement-1',
  classroom_id: classroom.id,
  title: 'Unit update',
  content: 'Read the [course outline](https://example.com/outline) and **bring notes**.',
  created_by: classroom.teacher_id,
  is_draft: false,
  published_at: '2026-05-13T12:00:00.000Z',
  scheduled_for: null,
  created_at: '2026-05-13T12:00:00.000Z',
  updated_at: '2026-05-13T12:00:00.000Z',
}

const secondClassroom: Classroom = {
  ...classroom,
  id: 'classroom-announcements-second',
  title: 'Second Announcements',
}

const secondClassroomAnnouncement: Announcement = {
  ...markdownAnnouncement,
  id: 'second-classroom-announcement',
  classroom_id: secondClassroom.id,
  title: 'Second classroom update',
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function mockAnnouncementFetch(announcements: Announcement[] = [markdownAnnouncement]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ success: true, marked: 1 }), { status: 200 })
      }

      return new Response(JSON.stringify({ announcements }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  )
}

function teacherAnnouncementsElement(sectionClassroom: Classroom) {
  return (
    <TooltipProvider>
      <TeacherAnnouncementsSection classroom={sectionClassroom} />
    </TooltipProvider>
  )
}

function UnreadAnnouncementCount() {
  const notifications = useStudentNotifications()
  return <div>Unread announcements: {notifications?.unreadAnnouncementsCount ?? 0}</div>
}

const suspendedClassroomRender = new Promise<never>(() => undefined)

function SuspendSecondClassroom({ classroomId }: { classroomId: string }) {
  if (classroomId === secondClassroom.id) throw suspendedClassroomRender
  return null
}

function TeacherTransitionHarness() {
  const [activeClassroom, setActiveClassroom] = useState(classroom)

  return (
    <TooltipProvider>
      <button
        type="button"
        onClick={() => startTransition(() => setActiveClassroom(secondClassroom))}
      >
        Attempt classroom switch
      </button>
      <Suspense fallback={<div>Switching classroom</div>}>
        <TeacherAnnouncementsSection classroom={activeClassroom} />
        <SuspendSecondClassroom classroomId={activeClassroom.id} />
      </Suspense>
    </TooltipProvider>
  )
}

function StudentTransitionHarness() {
  const [activeClassroom, setActiveClassroom] = useState(classroom)

  return (
    <>
      <button
        type="button"
        onClick={() => startTransition(() => setActiveClassroom(secondClassroom))}
      >
        Attempt student classroom switch
      </button>
      <Suspense fallback={<div>Switching student classroom</div>}>
        <StudentAnnouncementsSection classroom={activeClassroom} />
        <SuspendSecondClassroom classroomId={activeClassroom.id} />
      </Suspense>
    </>
  )
}

type MenuOwner = 'more' | 'new' | 'draft' | 'posted'

function teacherTabElement(isActive = true, sectionClassroom = classroom) {
  return <TooltipProvider><TeacherAnnouncementsTab classroom={sectionClassroom} isActive={isActive} /></TooltipProvider>
}

function motionForAnnouncementMenus() {
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList)
  const getStyle = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const style = getStyle(element, pseudo)
    const getProperty = style.getPropertyValue.bind(style)
    vi.spyOn(style, 'getPropertyValue').mockImplementation((property) => property === '--motion-duration-fast' ? '100ms' : getProperty(property))
    return style
  })
}

function capturedMenuClick(node: HTMLElement) {
  const key = Object.keys(node).find((name) => name.startsWith('__reactProps$'))!
  return (node as unknown as Record<string, { onClick: (event: { stopPropagation: () => void }) => void }>)[key].onClick
}

async function openAnnouncementMenu(owner: MenuOwner) {
  await screen.findByText('Unit update')
  if (owner === 'new') {
    fireEvent.click(screen.getByRole('button', { name: 'Create announcement' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Announcement body' }), { target: { value: 'Retained new draft' } })
  } else if (owner !== 'more') {
    fireEvent.click(screen.getByText('bring notes'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit announcement body' }), { target: { value: 'Retained edit draft' } })
  }
  fireEvent.click(screen.getByRole('button', { name: owner === 'more' ? 'More actions' : 'Choose announcement action' }))
  return screen.getByRole('menu')
}

function InactiveTransitionHarness() {
  const [isActive, setIsActive] = useState(true)
  return <TooltipProvider>
    <button onClick={() => startTransition(() => setIsActive(false))}>Attempt inactive tab</button>
    <Suspense fallback={<div>Changing tab</div>}>
      <TeacherAnnouncementsTab classroom={classroom} isActive={isActive} />
      {!isActive ? <SuspendSecondClassroom classroomId={secondClassroom.id} /> : null}
    </Suspense>
  </TooltipProvider>
}

describe('announcement markdown rendering', () => {
  beforeEach(() => {
    invalidateCachedJSONMatching('teacher-announcements:')
    invalidateCachedJSONMatching('student-announcements:')
    invalidateCachedJSONMatching('student-notifications:')
    mockAnnouncementFetch()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it.each([null, '2026-05-13T12:00:00Z'])('saves a changed post date only on explicit Save and retains it after failure (historical schedule=%s)', async scheduled_for => {
    const original = { ...markdownAnnouncement, scheduled_for }
    const patches: unknown[] = []
    let fail = true
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        patches.push(JSON.parse(init.body as string))
        return new Response(JSON.stringify({ announcement: { ...markdownAnnouncement,
          published_at: '2026-05-12T04:00:00.000Z', scheduled_for: null } }), { status: fail ? 500 : 200 })
      }
      return new Response(JSON.stringify({ announcements: [original] }), { status: 200 })
    }))
    render(teacherAnnouncementsElement(classroom))
    fireEvent.click(await screen.findByText('bring notes'))
    const field = screen.getByLabelText('Post date (Toronto)')
    expect(field).toHaveValue('2026-05-13')
    fireEvent.change(field, { target: { value: '2026-05-12' } })
    expect(patches).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }))
    await screen.findByRole('alert')
    expect(field).toHaveValue('2026-05-12')
    expect(patches).toEqual([{ posted_on: '2026-05-12' }])
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }))
    await waitFor(() => expect(screen.queryByLabelText('Post date (Toronto)')).not.toBeInTheDocument())
    fireEvent.click(screen.getByText('bring notes'))
    expect(screen.getByLabelText('Post date (Toronto)')).toHaveValue('2026-05-12')
  })

  it('disables invalid post-date Save while keeping the future scheduling action available', async () => {
    render(teacherAnnouncementsElement(classroom))
    fireEvent.click(await screen.findByText('bring notes'))
    fireEvent.change(screen.getByLabelText('Post date (Toronto)'), { target: { value: '' } })
    expect(screen.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
    expect(screen.getByText('Choose a valid date.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Choose announcement action' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Schedule...' }))
    expect(screen.getByLabelText('Date (Toronto)')).toBeInTheDocument()
  })

  it.each([null, '2026-05-13T12:00:00Z'])('schedules a future post date and retains it after failure (historical schedule=%s)', async scheduled_for => {
    const patches: unknown[] = []
    let fail = true
    const scheduledFor = '2099-01-01T05:00:00.000Z'
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        patches.push(JSON.parse(init.body as string))
        return new Response(JSON.stringify({ announcement: { ...markdownAnnouncement,
          published_at: scheduledFor, scheduled_for: scheduledFor } }), { status: fail ? 500 : 200 })
      }
      return new Response(JSON.stringify({ announcements: [{ ...markdownAnnouncement, scheduled_for }] }), { status: 200 })
    }))
    render(teacherAnnouncementsElement(classroom))
    fireEvent.click(await screen.findByText('bring notes'))
    fireEvent.change(screen.getByLabelText('Post date (Toronto)'), { target: { value: '2099-01-01' } })
    expect(patches).toEqual([])
    expect(screen.getByText('Hidden from students until midnight (Toronto) on this date.')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Schedule', exact: true }))
    await screen.findByRole('alert')
    expect(patches).toEqual([{ scheduled_for: scheduledFor }])
    expect(screen.getByLabelText('Post date (Toronto)')).toHaveValue('2099-01-01')
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Schedule', exact: true }))
    await waitFor(() => expect(screen.queryByLabelText('Post date (Toronto)')).not.toBeInTheDocument())
    expect(patches).toEqual([{ scheduled_for: scheduledFor }, { scheduled_for: scheduledFor }])
    expect(screen.getByText(/Scheduled for/)).toBeVisible()
  })

  it.each(['draft', 'scheduled', 'future-publication'] as const)('hides the post-date field for %s announcements', async state => {
    mockAnnouncementFetch([{ ...markdownAnnouncement, is_draft: state === 'draft',
      published_at: state === 'draft' ? null : '2099-01-01T12:00:00Z',
      scheduled_for: state === 'scheduled' ? '2099-01-01T12:00:00Z' : null }])
    render(teacherAnnouncementsElement(classroom))
    fireEvent.click(await screen.findByText('bring notes'))
    expect(screen.getByRole('textbox', { name: 'Edit announcement body' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Post date (Toronto)')).not.toBeInTheDocument()
    if (state === 'future-publication') expect(screen.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
  })

  it.each(['new', 'draft', 'posted'] as const)('keeps %s native picker text in an inert closing view without command authority', async (owner) => {
    motionForAnnouncementMenus()
    mockAnnouncementFetch([{ ...markdownAnnouncement, is_draft: owner === 'draft' }])
    const view = render(teacherTabElement())
    await openAnnouncementMenu(owner)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Schedule...' }))
    const date = screen.getByLabelText('Date (Toronto)')
    const time = screen.getByLabelText('Time (Toronto)')
    fireEvent.change(date, { target: { value: '2099-06-15' } })
    fireEvent.change(time, { target: { value: '09:45' } })
    const oldDone = capturedMenuClick(screen.getByRole('button', { name: 'Done' }))
    const picker = date.closest('.absolute') as HTMLElement
    fireEvent.click(within(picker).getByRole('button', { name: 'Cancel' }))
    const closing = view.container.querySelector('[data-schedule-picker-closing]') as HTMLElement
    expect(closing).toBeInTheDocument()
    expect(closing).toBe(picker)
    expect(closing).toHaveAttribute('aria-hidden', 'true')
    expect(closing.inert).toBe(true)
    expect(closing.querySelector('input[type="date"]')).toBe(date)
    expect(date).toHaveValue('2099-06-15')
    expect(time).toHaveValue('09:45')
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose announcement action' })).toHaveFocus()
    const closingDone = closing.querySelectorAll('button')[1]
    act(() => {
      oldDone({ stopPropagation() {} })
      capturedMenuClick(closingDone)({ stopPropagation() {} })
    })
    fireEvent.change(date, { target: { value: '2099-07-01' } })
    expect(screen.queryByRole('button', { name: /Jun 15|Jul 1/ })).not.toBeInTheDocument()
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method)).toBe(false)
    await waitFor(() => expect(view.container.querySelector('[data-schedule-picker-closing]')).not.toBeInTheDocument())
    expect(screen.queryByLabelText('Date (Toronto)')).not.toBeInTheDocument()
  })

  it.each(['new', 'draft', 'posted'] as const)('keeps a reopened %s picker active past its old closing expiry and retires it on inactivity', async (owner) => {
    motionForAnnouncementMenus()
    mockAnnouncementFetch([{ ...markdownAnnouncement, is_draft: owner === 'draft' }])
    const view = render(teacherTabElement())
    await openAnnouncementMenu(owner)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Schedule...' }))
    fireEvent.keyDown(screen.getByLabelText('Date (Toronto)'), { key: 'Escape' })
    expect(view.container.querySelector('[data-schedule-picker-closing]')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Choose announcement action' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Schedule...' }))
    const freshDate = screen.getByLabelText('Date (Toronto)')
    fireEvent.change(freshDate, { target: { value: '2099-06-16' } })
    await act(async () => new Promise(resolve => setTimeout(resolve, 120)))
    expect(freshDate).toHaveFocus()
    expect(freshDate).toHaveValue('2099-06-16')
    expect(view.container.querySelector('[data-schedule-picker-closing]')).not.toBeInTheDocument()
    fireEvent.keyDown(freshDate, { key: 'Escape' })
    expect(view.container.querySelector('[data-schedule-picker-closing]')).toBeInTheDocument()
    view.rerender(teacherTabElement(false))
    expect(view.container.querySelector('[data-schedule-picker-closing]')).not.toBeInTheDocument()
    view.rerender(teacherTabElement())
    expect(screen.queryByLabelText('Date (Toronto)')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: owner === 'new' ? 'Announcement body' : 'Edit announcement body' })).toHaveValue(owner === 'new' ? 'Retained new draft' : 'Retained edit draft')
  })

  it.each(['new', 'draft', 'posted'] as const)('dismisses the %s picker immediately for reduced motion', async (owner) => {
    motionForAnnouncementMenus()
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList)
    mockAnnouncementFetch([{ ...markdownAnnouncement, is_draft: owner === 'draft' }])
    const view = render(teacherTabElement())
    await openAnnouncementMenu(owner)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Schedule...' }))
    fireEvent.keyDown(screen.getByLabelText('Date (Toronto)'), { key: 'Escape' })
    expect(view.container.querySelector('[data-schedule-picker-closing]')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Date (Toronto)')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose announcement action' })).toHaveFocus()
  })

  it.each(['new', 'draft', 'posted'] as const)('retires the %s closing picker when reduced motion is enabled during its fade', async (owner) => {
    motionForAnnouncementMenus()
    const media = { matches: false, addEventListener: vi.fn<(type: string, listener: () => void) => void>(), removeEventListener: vi.fn() }
    vi.mocked(window.matchMedia).mockReturnValue(media as unknown as MediaQueryList)
    mockAnnouncementFetch([{ ...markdownAnnouncement, is_draft: owner === 'draft' }])
    const view = render(teacherTabElement())
    await openAnnouncementMenu(owner)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Schedule...' }))
    fireEvent.keyDown(screen.getByLabelText('Date (Toronto)'), { key: 'Escape' })
    expect(view.container.querySelector('[data-schedule-picker-closing]')).toBeInTheDocument()
    const focused = document.activeElement
    const onMotionChange = media.addEventListener.mock.calls.at(-1)![1] as () => void
    act(() => { media.matches = true; onMotionChange() })
    expect(view.container.querySelector('[data-schedule-picker-closing]')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(focused)
    expect(media.removeEventListener).toHaveBeenCalledWith('change', onMotionChange)
  })

  it.each(['new', 'draft', 'posted'] as const)('retires the %s closing picker on a committed read-only context', async (owner) => {
    motionForAnnouncementMenus()
    mockAnnouncementFetch([{ ...markdownAnnouncement, is_draft: owner === 'draft' }])
    const view = render(teacherTabElement())
    await openAnnouncementMenu(owner)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Schedule...' }))
    fireEvent.keyDown(screen.getByLabelText('Date (Toronto)'), { key: 'Escape' })
    expect(view.container.querySelector('[data-schedule-picker-closing]')).toBeInTheDocument()
    view.rerender(teacherTabElement(true, { ...classroom, archived_at: '2026-10-21T12:00:00Z' }))
    expect(view.container.querySelector('[data-schedule-picker-closing]')).not.toBeInTheDocument()
    view.rerender(teacherTabElement())
    expect(screen.queryByLabelText('Date (Toronto)')).not.toBeInTheDocument()
  })

  it.each(['more', 'new', 'draft', 'posted'] as const)('retires %s menu commands immediately and retains only inert closing presentation', async (owner) => {
    motionForAnnouncementMenus()
    mockAnnouncementFetch([{ ...markdownAnnouncement, is_draft: owner === 'draft' }])
    const view = render(teacherTabElement())
    const menu = await openAnnouncementMenu(owner)
    const item = within(menu).getAllByRole('menuitem')[0]
    const oldClick = capturedMenuClick(item)
    fireEvent.keyDown(item, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
    const closing = view.container.querySelector('[data-menu-closing]') as HTMLElement
    expect(closing).toHaveAttribute('aria-hidden', 'true')
    expect(closing.inert).toBe(true)
    expect(closing.id).toBe('')
    expect(closing.querySelectorAll('button,[tabindex],[role]')).toHaveLength(0)
    act(() => oldClick({ stopPropagation() {} }))
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method)).toBe(false)
    expect(screen.queryByLabelText('Date (Toronto)')).not.toBeInTheDocument()
    if (owner === 'more') expect(screen.queryByRole('textbox', { name: 'Announcement body' })).not.toBeInTheDocument()
  })

  it.each(['more', 'new', 'draft', 'posted'] as const)('retires live and fading %s menus when its cached teacher tab becomes inactive, retaining drafts', async (owner) => {
    motionForAnnouncementMenus()
    mockAnnouncementFetch([{ ...markdownAnnouncement, is_draft: owner === 'draft' }])
    const view = render(teacherTabElement())
    const menu = await openAnnouncementMenu(owner)
    const item = within(menu).getAllByRole('menuitem')[0]
    const oldClick = capturedMenuClick(item)
    view.rerender(teacherTabElement(false))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(view.container.querySelector('[data-menu-closing]')).not.toBeInTheDocument()
    act(() => oldClick({ stopPropagation() {} }))
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method)).toBe(false)
    view.rerender(teacherTabElement())
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    if (owner !== 'more') expect(screen.getByRole('textbox', { name: owner === 'new' ? 'Announcement body' : 'Edit announcement body' })).toHaveValue(owner === 'new' ? 'Retained new draft' : 'Retained edit draft')
    fireEvent.click(screen.getByRole('button', { name: owner === 'more' ? 'More actions' : 'Choose announcement action' }))
    fireEvent.keyDown(screen.getAllByRole('menuitem')[0], { key: 'Escape' })
    expect(view.container.querySelector('[data-menu-closing]')).toBeInTheDocument()
    view.rerender(teacherTabElement(false))
    expect(view.container.querySelector('[data-menu-closing]')).not.toBeInTheDocument()
  })

  it('keeps committed menu authority when an inactive-tab render suspends', async () => {
    render(<InactiveTransitionHarness />)
    await openAnnouncementMenu('more')
    const oldClick = capturedMenuClick(screen.getByRole('menuitem', { name: 'Announcement' }))
    fireEvent.click(screen.getByText('Attempt inactive tab'))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    act(() => oldClick({ stopPropagation() {} }))
    expect(screen.getByRole('textbox', { name: 'Announcement body' })).toBeInTheDocument()
  })

  it('keeps committed classroom menu authority when a replacement render suspends', async () => {
    render(<TeacherTransitionHarness />)
    await openAnnouncementMenu('more')
    const oldClick = capturedMenuClick(screen.getByRole('menuitem', { name: 'Announcement' }))
    fireEvent.click(screen.getByText('Attempt classroom switch'))
    act(() => oldClick({ stopPropagation() {} }))
    expect(screen.getByRole('textbox', { name: 'Announcement body' })).toBeInTheDocument()
  })

  it('retires the old menu command on a committed classroom replacement', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify({ announcements: String(input).includes(secondClassroom.id) ? [secondClassroomAnnouncement] : [markdownAnnouncement] }), { status: 200 })))
    const view = render(teacherTabElement())
    await openAnnouncementMenu('more')
    const oldClick = capturedMenuClick(screen.getByRole('menuitem', { name: 'Announcement' }))
    view.rerender(teacherTabElement(true, secondClassroom))
    await screen.findByText('Second classroom update')
    act(() => oldClick({ stopPropagation() {} }))
    expect(screen.queryByRole('textbox', { name: 'Announcement body' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('retires More on committed editor replacement without clearing the editor', async () => {
    const view = render(teacherTabElement())
    await openAnnouncementMenu('more')
    const oldClick = capturedMenuClick(screen.getByRole('menuitem', { name: 'Announcement' }))
    fireEvent.click(screen.getByText('bring notes'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    act(() => oldClick({ stopPropagation() {} }))
    expect(screen.queryByRole('textbox', { name: 'Announcement body' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Edit announcement body' })).toHaveValue(markdownAnnouncement.content)
    expect(view.container.querySelector('[data-menu-closing]')).not.toBeInTheDocument()
  })

  it.each(['new', 'draft', 'posted'] as const)('hands %s schedule selection to the existing picker immediately and cancels old deferred focus after inactivity', async (owner) => {
    motionForAnnouncementMenus()
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { frames.push(callback); return frames.length })
    mockAnnouncementFetch([{ ...markdownAnnouncement, is_draft: owner === 'draft' }])
    const view = render(teacherTabElement())
    await openAnnouncementMenu(owner)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Schedule...' }))
    expect(screen.getByLabelText('Date (Toronto)')).toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(view.container.querySelector('[data-menu-closing]')).not.toBeInTheDocument()
    view.rerender(teacherTabElement(false))
    act(() => { (document.activeElement as HTMLElement)?.blur(); frames.forEach((callback) => callback(0)) })
    expect(document.activeElement).toBe(document.body)
    view.rerender(teacherTabElement())
    expect(screen.getByRole('textbox', { name: owner === 'new' ? 'Announcement body' : 'Edit announcement body' })).toHaveValue(owner === 'new' ? 'Retained new draft' : 'Retained edit draft')
  })

  it.each(['new', 'draft', 'posted'] as const)('focuses the %s date field on entry and follows the picker natural Tab order', async (owner) => {
    mockAnnouncementFetch([{ ...markdownAnnouncement, is_draft: owner === 'draft' }])
    render(<>{teacherTabElement()}<button>After announcements</button></>)
    await openAnnouncementMenu(owner)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Schedule...' }))
    const date = screen.getByLabelText('Date (Toronto)')
    expect(date).toHaveFocus()
    fireEvent.change(date, { target: { value: '2099-06-15' } })
    const picker = date.closest('.absolute') as HTMLElement
    const user = userEvent.setup()
    await user.tab()
    expect(screen.getByLabelText('Time (Toronto)')).toHaveFocus()
    await user.tab()
    expect(within(picker).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.tab()
    expect(within(picker).getByRole('button', { name: 'Done' })).toHaveFocus()
    await user.tab()
    expect(owner === 'new' ? screen.getByRole('link', { name: 'course outline' }) : screen.getByRole('button', { name: 'After announcements' })).toHaveFocus()
    expect(screen.queryByLabelText('Date (Toronto)')).not.toBeInTheDocument()
  })

  it.each(['new', 'draft', 'posted'] as const)('retires the %s picker when focus returns outside after a transient null destination', async (owner) => {
    mockAnnouncementFetch([{ ...markdownAnnouncement, is_draft: owner === 'draft' }])
    render(<><button>Home</button>{teacherTabElement()}</>)
    await openAnnouncementMenu(owner)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Schedule...' }))
    const date = screen.getByLabelText('Date (Toronto)') as HTMLInputElement
    expect(date).toHaveFocus()
    const oldCancel = capturedMenuClick(within(date.closest('.absolute') as HTMLElement).getByRole('button', { name: 'Cancel' }))
    // Native date controls and browser chrome may blur without a DOM destination.
    act(() => date.blur())
    expect(document.activeElement).toBe(document.body)
    fireEvent.focusIn(document.body)
    expect(date).toBeInTheDocument()
    const home = screen.getByRole('button', { name: 'Home' })
    act(() => home.focus())
    expect(home).toHaveFocus()
    expect(screen.queryByLabelText('Date (Toronto)')).not.toBeInTheDocument()
    act(() => oldCancel({ stopPropagation() {} }))
    expect(home).toHaveFocus()
    expect(screen.getByRole('textbox', { name: owner === 'new' ? 'Announcement body' : 'Edit announcement body' })).toHaveValue(owner === 'new' ? 'Retained new draft' : 'Retained edit draft')
  })

  it.each(['new', 'draft', 'posted'] as const)('preserves the %s toggle as the backward Tab destination', async (owner) => {
    mockAnnouncementFetch([{ ...markdownAnnouncement, is_draft: owner === 'draft' }])
    render(teacherTabElement())
    await openAnnouncementMenu(owner)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Schedule...' }))
    expect(screen.getByLabelText('Date (Toronto)')).toHaveFocus()
    await userEvent.setup().tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Choose announcement action' })).toHaveFocus()
    expect(screen.queryByLabelText('Date (Toronto)')).not.toBeInTheDocument()
  })

  it.each(['new', 'draft', 'posted'] as const)('returns %s Cancel and Escape to the surviving action toggle and Done to the replacement primary', async (owner) => {
    mockAnnouncementFetch([{ ...markdownAnnouncement, is_draft: owner === 'draft' }])
    render(teacherTabElement())
    await openAnnouncementMenu(owner)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Schedule...' }))
    const toggle = screen.getByRole('button', { name: 'Choose announcement action' })
    const date = screen.getByLabelText('Date (Toronto)')
    const picker = date.closest('.absolute') as HTMLElement
    fireEvent.click(within(picker).getByRole('button', { name: 'Cancel' }))
    expect(toggle).toHaveFocus()
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Schedule...' }))
    fireEvent.keyDown(screen.getByLabelText('Time (Toronto)'), { key: 'Escape' })
    expect(toggle).toHaveFocus()
    expect(screen.getByRole('textbox', { name: owner === 'new' ? 'Announcement body' : 'Edit announcement body' })).toHaveValue(owner === 'new' ? 'Retained new draft' : 'Retained edit draft')
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Schedule...' }))
    fireEvent.change(screen.getByLabelText('Date (Toronto)'), { target: { value: '2099-06-15' } })
    fireEvent.change(screen.getByLabelText('Time (Toronto)'), { target: { value: '09:45' } })
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.getByRole('button', { name: owner === 'new' ? 'Schedule' : 'Save' })).toHaveFocus()
    const stamp = screen.getByRole('button', { name: /Jun 15/ })
    fireEvent.click(stamp)
    expect(screen.getByLabelText('Date (Toronto)')).toHaveFocus()
    expect(screen.getByLabelText('Date (Toronto)')).toHaveValue('2099-06-15')
    expect(screen.getByLabelText('Time (Toronto)')).toHaveValue('09:45')
    fireEvent.keyDown(screen.getByLabelText('Date (Toronto)'), { key: 'Escape' })
    expect(stamp).toHaveFocus()
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method)).toBe(false)
  })

  it.each(['new', 'draft', 'posted'] as const)('preserves an outside pointer focus destination for %s and never restores it after expiry', async (owner) => {
    mockAnnouncementFetch([{ ...markdownAnnouncement, is_draft: owner === 'draft' }, { ...markdownAnnouncement, id: 'outside-announcement', title: 'Outside announcement', content: 'Outside [course outline](https://example.com/outline)' }])
    render(teacherTabElement())
    await openAnnouncementMenu(owner)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Schedule...' }))
    const link = screen.getAllByRole('link', { name: 'course outline' })[0]
    fireEvent.mouseDown(link)
    act(() => link.focus())
    expect(link).toHaveFocus()
    expect(screen.queryByLabelText('Date (Toronto)')).not.toBeInTheDocument()
    await act(async () => new Promise((resolve) => setTimeout(resolve, 180)))
    expect(link).toHaveFocus()
  })

  it.each(['new', 'draft', 'posted'] as const)('retires the %s picker on hidden and read-only commits, preserves drafts/schedule, and rejects callbacks from the old opening', async (owner) => {
    mockAnnouncementFetch([{ ...markdownAnnouncement, is_draft: owner === 'draft' }])
    const view = render(teacherTabElement())
    await openAnnouncementMenu(owner)
    const title = screen.getByPlaceholderText('Title (optional)')
    fireEvent.change(title, { target: { value: 'Retained picker title' } })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Schedule...' }))
    fireEvent.change(screen.getByLabelText('Date (Toronto)'), { target: { value: '2099-06-15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    const stamp = screen.getByRole('button', { name: /Jun 15/ })
    fireEvent.click(stamp)
    const oldDone = capturedMenuClick(screen.getByRole('button', { name: 'Done' }))
    const oldCancel = capturedMenuClick(within(screen.getByLabelText('Date (Toronto)').closest('.absolute') as HTMLElement).getByRole('button', { name: 'Cancel' }))
    view.rerender(teacherTabElement(false))
    expect(screen.queryByLabelText('Date (Toronto)')).not.toBeInTheDocument()
    view.rerender(teacherTabElement())
    expect(screen.queryByLabelText('Date (Toronto)')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: owner === 'new' ? 'Announcement body' : 'Edit announcement body' })).toHaveValue(owner === 'new' ? 'Retained new draft' : 'Retained edit draft')
    fireEvent.click(stamp)
    const freshDate = screen.getByLabelText('Date (Toronto)')
    fireEvent.change(freshDate, { target: { value: '2099-06-16' } })
    act(() => { oldDone({ stopPropagation() {} }); oldCancel({ stopPropagation() {} }) })
    expect(freshDate).toHaveFocus()
    expect(freshDate).toHaveValue('2099-06-16')
    expect(stamp).toHaveTextContent('Jun 15')
    view.rerender(teacherTabElement(true, { ...classroom, archived_at: '2026-10-14T00:00:00.000Z' }))
    expect(screen.queryByLabelText('Date (Toronto)')).not.toBeInTheDocument()
    act(() => oldDone({ stopPropagation() {} }))
    view.rerender(teacherTabElement())
    expect(screen.queryByLabelText('Date (Toronto)')).not.toBeInTheDocument()
    expect(stamp).toHaveTextContent('Jun 15')
    expect(screen.getByPlaceholderText('Title (optional)')).toBe(title)
    expect(title).toHaveValue('Retained picker title')
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method)).toBe(false)
  })

  it.each(['inactive', 'classroom'] as const)('retains committed picker authority when an attempted %s replacement suspends', async (attempt) => {
    render(attempt === 'inactive' ? <InactiveTransitionHarness /> : <TeacherTransitionHarness />)
    await openAnnouncementMenu('new')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Schedule...' }))
    const date = screen.getByLabelText('Date (Toronto)')
    const oldDone = capturedMenuClick(screen.getByRole('button', { name: 'Done' }))
    fireEvent.change(date, { target: { value: '2099-06-15' } })
    // Capture after the selected date commits, then attempt an abandoned owner.
    const done = capturedMenuClick(screen.getByRole('button', { name: 'Done' }))
    fireEvent.click(screen.getByText(attempt === 'inactive' ? 'Attempt inactive tab' : 'Attempt classroom switch'))
    expect(date).toBeInTheDocument()
    act(() => done({ stopPropagation() {} }))
    expect(screen.queryByLabelText('Date (Toronto)')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Schedule' })).toHaveFocus()
    act(() => oldDone({ stopPropagation() {} }))
    expect(screen.getByRole('button', { name: 'Schedule' })).toHaveFocus()
  })

  it('retires picker callbacks on committed editor and classroom replacement and unmount', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify({ announcements: String(input).includes(secondClassroom.id) ? [secondClassroomAnnouncement] : [markdownAnnouncement, { ...markdownAnnouncement, id: 'other-editor', title: 'Other editor', content: 'Other editor content' }] }), { status: 200 })))
    const view = render(teacherTabElement())
    await openAnnouncementMenu('posted')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Schedule...' }))
    fireEvent.change(screen.getByLabelText('Date (Toronto)'), { target: { value: '2099-06-15' } })
    const oldDone = capturedMenuClick(screen.getByRole('button', { name: 'Done' }))
    fireEvent.click(screen.getByText('Other editor'))
    act(() => oldDone({ stopPropagation() {} }))
    expect(screen.queryByLabelText('Date (Toronto)')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Edit announcement body' })).toHaveValue('Other editor content')
    expect(screen.getByRole('textbox', { name: 'Edit announcement body' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Choose announcement action' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Schedule...' }))
    const replacedDone = capturedMenuClick(screen.getByRole('button', { name: 'Done' }))
    view.rerender(teacherTabElement(true, secondClassroom))
    await screen.findByText('Second classroom update')
    act(() => replacedDone({ stopPropagation() {} }))
    expect(screen.queryByLabelText('Date (Toronto)')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /announcement body/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create announcement' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Announcement body' }), { target: { value: 'Next owner' } })
    fireEvent.click(screen.getByRole('button', { name: 'Choose announcement action' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Schedule...' }))
    const unmountedDone = capturedMenuClick(screen.getByRole('button', { name: 'Done' }))
    view.unmount()
    act(() => unmountedDone({ stopPropagation() {} }))
    expect(document.activeElement).toBe(document.body)
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method)).toBe(false)
  })

  it('hands More to the new editor immediately and preserves its existing textarea focus', async () => {
    motionForAnnouncementMenus()
    const view = render(teacherTabElement())
    await openAnnouncementMenu('more')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Announcement' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(view.container.querySelector('[data-menu-closing]')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Announcement body' })).toHaveFocus()
  })

  it.each(['new', 'draft', 'posted'] as const)('keeps the %s primary save/publication action available while its schedule picker is open', async (owner) => {
    const response = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method ? response.promise : new Response(JSON.stringify({ announcements: [{ ...markdownAnnouncement, is_draft: owner === 'draft' }] }), { status: 200 })))
    render(teacherTabElement())
    await openAnnouncementMenu(owner)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Schedule...' }))
    fireEvent.click(screen.getByRole('button', { name: owner === 'posted' ? 'Save' : 'Post' }))
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === (owner === 'new' ? 'POST' : 'PATCH'))).toHaveLength(1)
    await act(async () => response.resolve(new Response(JSON.stringify({ announcement: { ...markdownAnnouncement, content: 'Published from picker' } }), { status: 200 })))
    expect(screen.getByText('Published from picker', { selector: 'p' })).toBeInTheDocument()
  })

  it.each(['POST', 'PATCH'] as const)('settles a held %s after unmount without reviving an old editor or menu', async (method) => {
    const response = deferred<Response>()
    let settled = false
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === method ? response.promise : new Response(JSON.stringify({ announcements: [{ ...markdownAnnouncement, content: settled ? 'Fresh after unmount' : markdownAnnouncement.content }] }), { status: 200 })))
    const view = render(teacherTabElement())
    await openAnnouncementMenu(method === 'POST' ? 'new' : 'posted')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Schedule...' }))
    fireEvent.click(screen.getByRole('button', { name: method === 'POST' ? 'Post' : 'Save' }))
    view.unmount()
    settled = true
    await act(async () => response.resolve(new Response(JSON.stringify({ announcement: { ...markdownAnnouncement, content: 'Fresh after unmount' } }), { status: 200 })))
    render(teacherTabElement())
    expect(await screen.findByText('Fresh after unmount', { selector: 'p' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /announcement body/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it.each([{ method: 'POST', status: 200 }, { method: 'POST', status: 500 }, { method: 'PATCH', status: 200 }, { method: 'PATCH', status: 500 }] as const)('settles a held $method status $status while the cached tab is inactive without losing request ownership', async ({ method, status }) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === method ? response.promise : new Response(JSON.stringify({ announcements: [markdownAnnouncement] }), { status: 200 })))
    const view = render(teacherTabElement())
    await openAnnouncementMenu(method === 'POST' ? 'new' : 'posted')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Schedule...' }))
    fireEvent.click(screen.getByRole('button', { name: method === 'POST' ? 'Post' : 'Save' }))
    view.rerender(teacherTabElement(false))
    await act(async () => response.resolve(new Response(JSON.stringify({ announcement: { ...markdownAnnouncement, id: method === 'POST' ? 'inactive-create' : markdownAnnouncement.id, content: 'Settled while inactive' } }), { status })))
    view.rerender(teacherTabElement())
    if (status === 200) {
      expect(screen.getByText('Settled while inactive', { selector: 'p' })).toBeInTheDocument()
      expect(screen.queryByRole('textbox', { name: /announcement body/i })).not.toBeInTheDocument()
    } else {
      expect(screen.getByRole('alert')).toHaveTextContent('Pika could not confirm')
      expect(screen.getByRole('textbox', { name: method === 'POST' ? 'Announcement body' : 'Edit announcement body' })).toHaveValue(method === 'POST' ? 'Retained new draft' : 'Retained edit draft')
      expect(screen.getByRole('button', { name: method === 'POST' ? 'Post' : 'Save' })).toBeEnabled()
    }
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it.each(['publish', 'draft', 'schedule'] as const)('shows an unconfirmed %s failure and retains the creation fields until explicit recovery', async (mode) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = deferred<Response>()
    let postCount = 0
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        postCount += 1
        if (postCount === 1) return response.promise
        return new Response(JSON.stringify({ announcement: {
          ...markdownAnnouncement, id: 'recovered-create', title: 'Retained title', content: 'Retained body',
          is_draft: mode === 'draft', scheduled_for: mode === 'schedule' ? '2099-06-15T13:45:00.000Z' : null,
        } }), { status: 201 })
      }
      return new Response(JSON.stringify({ announcements: [markdownAnnouncement] }), { status: 200 })
    }))
    render(teacherAnnouncementsElement(classroom))
    await screen.findByText('Unit update')
    fireEvent.click(screen.getByRole('button', { name: 'Create announcement' }))
    fireEvent.change(screen.getByPlaceholderText('Title (optional)'), { target: { value: 'Retained title' } })
    const textarea = screen.getByRole('textbox', { name: 'Announcement body' }) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'Retained body' } })
    if (mode !== 'publish') {
      fireEvent.click(screen.getByRole('button', { name: 'Choose announcement action' }))
      fireEvent.click(screen.getByRole('menuitem', { name: mode === 'draft' ? 'Save draft' : 'Schedule...' }))
    }
    if (mode === 'schedule') {
      fireEvent.change(screen.getByLabelText('Date (Toronto)'), { target: { value: '2099-06-15' } })
      fireEvent.change(screen.getByLabelText('Time (Toronto)'), { target: { value: '09:45' } })
      fireEvent.click(screen.getByRole('button', { name: 'Done' }))
      fireEvent.click(screen.getByRole('button', { name: 'Schedule' }))
    } else if (mode === 'publish') {
      fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    }
    const listLink = screen.getByRole('link', { name: 'course outline' })
    listLink.focus()
    textarea.setSelectionRange(3, 3)
    const height = textarea.style.height
    await act(async () => response.resolve(new Response('{}', { status: 500 })))
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(`Pika could not confirm ${mode === 'publish' ? 'posting this announcement' : mode === 'draft' ? 'saving this draft' : 'scheduling this announcement'}.`)
    expect(alert).toHaveTextContent('Review the announcement list')
    expect(screen.getByPlaceholderText('Title (optional)')).toHaveValue('Retained title')
    expect(screen.getByRole('textbox', { name: 'Announcement body' })).toBe(textarea)
    expect(textarea).toHaveValue('Retained body')
    expect(textarea.selectionStart).toBe(3)
    expect(textarea.style.height).toBe(height)
    expect(listLink).toHaveFocus()
    expect(postCount).toBe(1)
    if (mode === 'draft') {
      fireEvent.click(screen.getByRole('button', { name: 'Choose announcement action' }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Save draft' }))
    } else {
      fireEvent.click(screen.getByRole('button', { name: mode === 'schedule' ? 'Schedule' : 'Post' }))
    }
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(postCount).toBe(2)
    expect(screen.getByText('Retained body', { selector: 'p' })).toBeInTheDocument()
    consoleError.mockRestore()
  })

  it('retains edit fields and schedule after an unconfirmed save and clears only the edit failure on recovery', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let patchCount = 0
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        patchCount += 1
        if (patchCount === 1) throw new TypeError('Network disconnected')
        return new Response(JSON.stringify({ announcement: {
          ...markdownAnnouncement, title: 'Edited title', content: 'Edited body', scheduled_for: '2099-06-15T13:45:00.000Z',
        } }), { status: 200 })
      }
      return new Response(JSON.stringify({ announcements: [markdownAnnouncement] }), { status: 200 })
    }))
    render(teacherAnnouncementsElement(classroom))
    await screen.findByText('Unit update')
    fireEvent.click(screen.getByText('bring notes'))
    fireEvent.change(screen.getByPlaceholderText('Title (optional)'), { target: { value: 'Edited title' } })
    const textarea = screen.getByRole('textbox', { name: 'Edit announcement body' })
    fireEvent.change(textarea, { target: { value: 'Edited body' } })
    fireEvent.click(screen.getByRole('button', { name: 'Choose announcement action' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Schedule...' }))
    fireEvent.change(screen.getByLabelText('Date (Toronto)'), { target: { value: '2099-06-15' } })
    fireEvent.change(screen.getByLabelText('Time (Toronto)'), { target: { value: '09:45' } })
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Pika could not confirm saving changes to this announcement.')
    expect(screen.getByRole('textbox', { name: 'Edit announcement body' })).toBe(textarea)
    expect(textarea).toHaveValue('Edited body')
    expect(screen.getByPlaceholderText('Title (optional)')).toHaveValue('Edited title')
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(patchCount).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(screen.getByText('Edited body')).toBeInTheDocument()
    consoleError.mockRestore()
  })

  it('identifies a failed delete and requires a fresh confirmation, while unrelated create success preserves its error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let deleteCount = 0
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        deleteCount += 1
        return new Response('{}', { status: deleteCount === 1 ? 500 : 200 })
      }
      if (init?.method === 'POST') return new Response(JSON.stringify({ announcement: {
        ...markdownAnnouncement, id: 'unrelated-create', title: 'Other update', content: 'Other content',
      } }), { status: 201 })
      return new Response(JSON.stringify({ announcements: [markdownAnnouncement] }), { status: 200 })
    }))
    render(teacherAnnouncementsElement(classroom))
    await screen.findByText('Unit update')
    fireEvent.click(screen.getByRole('button', { name: 'Delete announcement' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Pika could not confirm deleting “Unit update”.')
    expect(screen.getByText('Unit update')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(deleteCount).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Create announcement' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Announcement body' }), { target: { value: 'Other content' } })
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    await screen.findByText('Other update')
    expect(screen.getByRole('alert')).toHaveTextContent('Pika could not confirm deleting “Unit update”.')
    fireEvent.click(screen.getByRole('button', { name: 'Retry delete' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Unit update')
    expect(deleteCount).toBe(1)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(deleteCount).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Retry delete' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(deleteCount).toBe(2)
    expect(screen.queryByText('Unit update')).not.toBeInTheDocument()
    consoleError.mockRestore()
  })

  it('retires existing failure feedback on a committed classroom change', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'DELETE') return new Response('{}', { status: 500 })
      return new Response(JSON.stringify({ announcements: String(input).includes(secondClassroom.id)
        ? [secondClassroomAnnouncement] : [markdownAnnouncement] }), { status: 200 })
    }))
    const view = render(teacherAnnouncementsElement(classroom))
    await screen.findByText('Unit update')
    fireEvent.click(screen.getByRole('button', { name: 'Delete announcement' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Unit update')
    view.rerender(teacherAnnouncementsElement(secondClassroom))
    await screen.findByText('Second classroom update')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry delete' })).not.toBeInTheDocument()
  })

  it('preserves a creation failure when an unrelated announcement is deleted successfully', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response('{}', { status: 500 })
      if (init?.method === 'DELETE') return new Response('{}', { status: 200 })
      return new Response(JSON.stringify({ announcements: [markdownAnnouncement] }), { status: 200 })
    }))
    render(teacherAnnouncementsElement(classroom))
    await screen.findByText('Unit update')
    fireEvent.click(screen.getByRole('button', { name: 'Create announcement' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Announcement body' }), { target: { value: 'Pending creation' } })
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Pika could not confirm posting this announcement.')
    fireEvent.click(screen.getByRole('button', { name: 'Delete announcement' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent('Pika could not confirm posting this announcement.')
    expect(screen.getByRole('textbox', { name: 'Announcement body' })).toHaveValue('Pending creation')
  })

  it('renders teacher announcements as markdown without turning link clicks into edit mode', async () => {
    render(teacherAnnouncementsElement(classroom))

    const link = await screen.findByRole('link', { name: 'course outline' })

    expect(link).toHaveAttribute('href', 'https://example.com/outline')
    expect(screen.getByText('Unit update')).toBeInTheDocument()
    expect(screen.getByText('bring notes')).toBeInTheDocument()

    fireEvent.click(link)

    await waitFor(() => {
      expect(screen.queryByDisplayValue(markdownAnnouncement.content)).not.toBeInTheDocument()
    })
  })

  it('reuses the teacher announcement cache on remount', async () => {
    const fetchMock = vi.mocked(fetch)

    const firstRender = render(teacherAnnouncementsElement(classroom))

    await screen.findByRole('link', { name: 'course outline' })

    firstRender.unmount()
    render(teacherAnnouncementsElement(classroom))

    await screen.findByRole('link', { name: 'course outline' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('renders a larger, vertically resizable creation textarea', async () => {
    const { container } = render(teacherAnnouncementsElement(classroom))

    await screen.findByRole('link', { name: 'course outline' })
    fireEvent.click(screen.getByRole('button', { name: 'Create announcement' }))

    const titleInput = screen.getByPlaceholderText('Title (optional)')
    const titleLabel = container.querySelector(`label[for="${titleInput.id}"]`)
    expect(titleLabel).toHaveClass('sr-only')
    expect(screen.queryByPlaceholderText('Optional title')).not.toBeInTheDocument()
    expect(titleInput.compareDocumentPosition(screen.getByText('Unit update')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    const textarea = screen.getByRole('textbox', { name: 'Announcement body' })
    expect(textarea).toHaveAttribute('rows', '6')
    expect(textarea).toHaveClass('min-h-[10rem]')
    expect(textarea).toHaveClass('resize-y')

    fireEvent.change(textarea, { target: { value: 'Announcement draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Choose announcement action' }))
    expect(screen.getByRole('menuitem', { name: 'Save draft' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Schedule...' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Schedule...' }))

    const scheduleDateInput = screen.getByLabelText('Date (Toronto)')
    expect(scheduleDateInput.closest('div.absolute')).toHaveClass('bottom-full', 'mb-1')
  })

  it('saves a teacher draft without posting or scheduling it', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST') {
          const body = JSON.parse(String(init.body))
          return new Response(JSON.stringify({
            announcement: {
              ...markdownAnnouncement,
              id: 'draft-announcement',
              content: body.content,
              is_draft: true,
              published_at: null,
            },
          }), { status: 201 })
        }
        return new Response(JSON.stringify({ announcements: [markdownAnnouncement] }), { status: 200 })
      }),
    )

    render(teacherAnnouncementsElement(classroom))
    await screen.findByText('Unit update')
    fireEvent.click(screen.getByRole('button', { name: 'Create announcement' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Announcement body' }), {
      target: { value: 'Private draft content' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Choose announcement action' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Save draft' }))

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2))
    expect(consoleError).not.toHaveBeenCalled()
    expect(screen.getByText(/Draft · Saved/)).toBeInTheDocument()
    const postCall = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'POST')
    expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({
      content: 'Private draft content',
      is_draft: true,
    })
    consoleError.mockRestore()
  })

  it('keeps announcement creation in the shared action surface menu', async () => {
    render(teacherAnnouncementsElement(classroom))

    await screen.findByRole('link', { name: 'course outline' })

    const contextBar = screen.getByRole('region', { name: 'Announcement controls' })
    expect(contextBar).toHaveClass('grid', 'relative', 'z-floating')
    expect(screen.getByRole('button', { name: 'Create announcement' })).toBeInTheDocument()
    const actionsTrigger = screen.getByRole('button', { name: 'More actions' })
    expect(actionsTrigger.closest('.fixed')).toBeNull()
    expect(actionsTrigger).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(actionsTrigger)

    const menu = screen.getByRole('menu', { name: 'Announcement actions' })
    const expandedTrigger = screen.getByRole('button', { name: 'More actions' })
    expect(menu).toBeInTheDocument()
    expect(expandedTrigger).toHaveAttribute('aria-expanded', 'true')
    expect(expandedTrigger).toHaveAttribute('aria-controls', menu.id)
    expect(screen.getByRole('menuitem', { name: 'Announcement' })).toBeInTheDocument()
  })

  it('labels the edit announcement textarea and keeps its schedule picker above the trigger', async () => {
    render(teacherAnnouncementsElement(classroom))

    await screen.findByRole('link', { name: 'course outline' })
    fireEvent.click(screen.getByText('bring notes'))

    expect(screen.getByRole('textbox', { name: 'Edit announcement body' })).toHaveValue(
      markdownAnnouncement.content,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Choose announcement action' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Schedule...' }))

    const scheduleDateInput = screen.getByLabelText('Date (Toronto)')
    expect(scheduleDateInput.closest('div.absolute')).toHaveClass('bottom-full', 'mb-1')
  })

  it('shows teacher announcements in publication order', async () => {
    mockAnnouncementFetch([
      {
        ...markdownAnnouncement,
        id: 'older-scheduled-announcement',
        title: 'Older scheduled update',
        published_at: '2099-05-20T12:00:00.000Z',
        scheduled_for: '2099-05-20T12:00:00.000Z',
        created_at: '2026-05-12T12:00:00.000Z',
        updated_at: '2026-05-12T12:00:00.000Z',
      },
      {
        ...markdownAnnouncement,
        id: 'newest-announcement',
        title: 'Newest update',
        scheduled_for: null,
        created_at: '2026-05-14T12:00:00.000Z',
        updated_at: '2026-05-14T12:00:00.000Z',
      },
      {
        ...markdownAnnouncement,
        id: 'middle-announcement',
        title: 'Middle update',
        scheduled_for: null,
        created_at: '2026-05-13T12:00:00.000Z',
        updated_at: '2026-05-13T12:00:00.000Z',
      },
    ])

    render(teacherAnnouncementsElement(classroom))

    const newest = await screen.findByText('Newest update')
    const middle = screen.getByText('Middle update')
    const scheduled = screen.getByText('Older scheduled update')

    expect(scheduled.compareDocumentPosition(newest) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(newest.compareDocumentPosition(middle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('renders student announcements as markdown links', async () => {
    render(<StudentAnnouncementsSection classroom={classroom} />)

    const link = await screen.findByRole('link', { name: 'course outline' })

    expect(link).toHaveAttribute('href', 'https://example.com/outline')
    expect(link).toHaveAttribute('target', '_blank')
    expect(screen.getByText('Unit update')).toBeInTheDocument()
    expect(screen.getByText('bring notes')).toBeInTheDocument()
  })

  it('shows a retryable teacher error instead of a false empty state', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Unavailable' }), { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ announcements: [markdownAnnouncement] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
    vi.stubGlobal('fetch', fetchMock)

    render(teacherAnnouncementsElement(classroom))

    expect(await screen.findByRole('alert')).toHaveTextContent("Announcements couldn't load")
    expect(screen.queryByText(/No announcements yet/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('Unit update')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    consoleError.mockRestore()
  })

  it('shows a retryable student error instead of a false empty state', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Unavailable' }), { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ announcements: [markdownAnnouncement] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, marked: 1 }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    render(<StudentAnnouncementsSection classroom={classroom} />)

    expect(await screen.findByRole('alert')).toHaveTextContent("Announcements couldn't load")
    expect(screen.queryByText('No announcements yet')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('Unit update')).toBeInTheDocument()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    consoleError.mockRestore()
  })

  it('keeps failed student read acknowledgement visible and retryable', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let postCount = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST') {
          postCount += 1
          return postCount === 1
            ? new Response(JSON.stringify({ error: 'Unavailable' }), { status: 500 })
            : new Response(JSON.stringify({ success: true, marked: 1 }), { status: 200 })
        }

        return new Response(JSON.stringify({ announcements: [markdownAnnouncement] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )

    render(<StudentAnnouncementsSection classroom={classroom} />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Announcements are visible, but Pika could not mark them as read.',
    )
    expect(screen.getByText('Unit update')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(postCount).toBe(2))
    await waitFor(() => {
      expect(screen.queryByText('Announcements are visible, but Pika could not mark them as read.')).not.toBeInTheDocument()
    })
    consoleError.mockRestore()
  })

  it('does not retry a failed read acknowledgement when notification state settles', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let resolveNotifications!: (response: Response) => void
    const notificationsResponse = new Promise<Response>((resolve) => {
      resolveNotifications = resolve
    })
    let postCount = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes('/api/student/notifications')) {
          return notificationsResponse
        }
        if (init?.method === 'POST') {
          postCount += 1
          return postCount === 1
            ? new Response(JSON.stringify({ error: 'Unavailable' }), { status: 500 })
            : new Response(JSON.stringify({ success: true, marked: 1 }), { status: 200 })
        }

        return new Response(JSON.stringify({ announcements: [markdownAnnouncement] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )

    render(
      <StudentNotificationsProvider classroomId={classroom.id}>
        <UnreadAnnouncementCount />
        <StudentAnnouncementsSection classroom={classroom} />
      </StudentNotificationsProvider>,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Announcements are visible, but Pika could not mark them as read.',
    )
    expect(postCount).toBe(1)

    await act(async () => {
      resolveNotifications(
        new Response(JSON.stringify({
          hasTodayEntry: true,
          unviewedAssignmentsCount: 0,
          activeTestsCount: 0,
          unreadAnnouncementsCount: 1,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })

    expect(await screen.findByText('Unread announcements: 1')).toBeInTheDocument()
    expect(postCount).toBe(1)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Announcements are visible, but Pika could not mark them as read.',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(postCount).toBe(2))
    expect(await screen.findByText('Unread announcements: 0')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    consoleError.mockRestore()
  })

  it('finishes a student read acknowledgement when a classroom switch is suspended', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const readResponse = deferred<Response>()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST') return readResponse.promise
        return new Response(JSON.stringify({ announcements: [markdownAnnouncement] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )

    render(<StudentTransitionHarness />)
    await screen.findByText('Unit update')
    await waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        `/api/student/classrooms/${classroom.id}/announcements`,
        { method: 'POST' },
      )
    })
    fireEvent.click(screen.getByRole('button', { name: 'Attempt student classroom switch' }))

    await act(async () => {
      readResponse.resolve(
        new Response(JSON.stringify({ error: 'Unavailable' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Announcements are visible, but Pika could not mark them as read.',
    )
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
    consoleError.mockRestore()
  })

  it('does not keep stale teacher announcements visible while loading another classroom', async () => {
    let resolveSecondRead: ((response: Response) => void) | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes(secondClassroom.id)) {
          return new Promise<Response>((resolve) => {
            resolveSecondRead = resolve
          })
        }

        return new Response(JSON.stringify({ announcements: [markdownAnnouncement] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )

    const secondAnnouncement: Announcement = {
      ...markdownAnnouncement,
      id: 'second-announcement',
      classroom_id: secondClassroom.id,
      title: 'Second classroom update',
    }

    const view = render(teacherAnnouncementsElement(classroom))

    await screen.findByText('Unit update')

    view.rerender(teacherAnnouncementsElement(secondClassroom))

    expect(screen.queryByText('Unit update')).not.toBeInTheDocument()

    await act(async () => {
      resolveSecondRead?.(
        new Response(JSON.stringify({ announcements: [secondAnnouncement] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })

    expect(await screen.findByText('Second classroom update')).toBeInTheDocument()
  })

  it('does not relabel old teacher announcements when the next classroom fails to load', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes(secondClassroom.id)) {
          return new Response(JSON.stringify({ error: 'Unavailable' }), { status: 500 })
        }

        return new Response(JSON.stringify({ announcements: [markdownAnnouncement] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )

    const view = render(teacherAnnouncementsElement(classroom))
    await screen.findByText('Unit update')

    view.rerender(teacherAnnouncementsElement(secondClassroom))

    expect(await screen.findByRole('alert')).toHaveTextContent("Announcements couldn't load")
    expect(screen.queryByText('Unit update')).not.toBeInTheDocument()
    consoleError.mockRestore()
  })

  it('ignores a failed teacher create after switching classrooms', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const createResponse = deferred<Response>()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST') return createResponse.promise
        const announcements = String(input).includes(secondClassroom.id)
          ? [secondClassroomAnnouncement]
          : [markdownAnnouncement]
        return new Response(JSON.stringify({ announcements }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )

    const view = render(teacherAnnouncementsElement(classroom))
    await screen.findByText('Unit update')
    fireEvent.click(screen.getByRole('button', { name: 'Create announcement' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Announcement body' }), {
      target: { value: 'Pending Classroom A update' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))

    expect(await screen.findByText('Pending Classroom A update', { selector: 'p' })).toBeInTheDocument()
    view.rerender(teacherAnnouncementsElement(secondClassroom))
    expect(await screen.findByText('Second classroom update')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create announcement' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Delete announcement' })).toBeEnabled()

    await act(async () => {
      createResponse.resolve(
        new Response(JSON.stringify({ error: 'Unavailable' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })

    expect(screen.getByText('Second classroom update')).toBeInTheDocument()
    expect(screen.queryByText('Pending Classroom A update')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create announcement' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Delete announcement' })).toBeEnabled()
    consoleError.mockRestore()
  })

  it('ignores a failed teacher edit after switching classrooms', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const editResponse = deferred<Response>()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'PATCH') return editResponse.promise
        const announcements = String(input).includes(secondClassroom.id)
          ? [secondClassroomAnnouncement]
          : [markdownAnnouncement]
        return new Response(JSON.stringify({ announcements }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )

    const view = render(teacherAnnouncementsElement(classroom))
    await screen.findByText('Unit update')
    fireEvent.click(screen.getByText('bring notes'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit announcement body' }), {
      target: { value: 'Edited Classroom A update' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    view.rerender(teacherAnnouncementsElement(secondClassroom))
    expect(await screen.findByText('Second classroom update')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create announcement' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Delete announcement' })).toBeEnabled()

    await act(async () => {
      editResponse.resolve(
        new Response(JSON.stringify({ error: 'Unavailable' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })

    expect(screen.getByText('Second classroom update')).toBeInTheDocument()
    expect(screen.queryByText('Edited Classroom A update')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create announcement' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Delete announcement' })).toBeEnabled()
    consoleError.mockRestore()
  })

  it.each([200, 500])('ignores a teacher delete response with status %s after switching classrooms', async (status) => {
    const deleteResponse = deferred<Response>()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'DELETE') return deleteResponse.promise
        const announcements = String(input).includes(secondClassroom.id)
          ? [secondClassroomAnnouncement]
          : [markdownAnnouncement]
        return new Response(JSON.stringify({ announcements }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )

    const view = render(teacherAnnouncementsElement(classroom))
    await screen.findByText('Unit update')
    fireEvent.click(screen.getByRole('button', { name: 'Delete announcement' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))

    view.rerender(teacherAnnouncementsElement(secondClassroom))
    expect(await screen.findByText('Second classroom update')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create announcement' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Delete announcement' })).toBeEnabled()

    await act(async () => {
      deleteResponse.resolve(
        new Response(JSON.stringify({ success: true }), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('Second classroom update')).toBeInTheDocument()
    expect(screen.queryByText('Unit update')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create announcement' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Delete announcement' })).toBeEnabled()
  })

  it.each([200, 500])('finishes a teacher create response with status %s when a suspended classroom switch is abandoned', async (status) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const createResponse = deferred<Response>()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST') return createResponse.promise
        return new Response(JSON.stringify({ announcements: [markdownAnnouncement] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )

    render(<TeacherTransitionHarness />)
    await screen.findByText('Unit update')
    fireEvent.click(screen.getByRole('button', { name: 'Create announcement' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Announcement body' }), {
      target: { value: 'Created while switch is suspended' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    fireEvent.click(screen.getByText('Attempt classroom switch'))

    await act(async () => {
      createResponse.resolve(
        new Response(JSON.stringify({
          announcement: {
            ...markdownAnnouncement,
            id: 'created-during-suspense',
            content: 'Created while switch is suspended',
          },
        }), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })

    if (status === 200) {
      expect(screen.getByText('Created while switch is suspended', { selector: 'p' })).toBeInTheDocument()
    } else {
      expect(screen.getByRole('alert')).toHaveTextContent('Pika could not confirm posting this announcement.')
      expect(screen.getByRole('textbox', { name: 'Announcement body' })).toHaveValue('Created while switch is suspended')
      expect(screen.getByRole('button', { name: 'Post' })).toBeEnabled()
    }
    if (status === 200) {
      expect(screen.getByRole('button', { name: 'Create announcement' })).toBeEnabled()
    } else {
      expect(screen.getByRole('button', { name: 'Create announcement' })).toBeDisabled()
    }
  })

  it.each([200, 500])('finishes a teacher edit response with status %s when a suspended classroom switch is abandoned', async (status) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const editResponse = deferred<Response>()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'PATCH') return editResponse.promise
        return new Response(JSON.stringify({ announcements: [markdownAnnouncement] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )

    render(<TeacherTransitionHarness />)
    await screen.findByText('Unit update')
    fireEvent.click(screen.getByText('bring notes'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit announcement body' }), {
      target: { value: 'Edited while switch is suspended' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.click(screen.getByRole('button', { name: 'Attempt classroom switch' }))

    await act(async () => {
      editResponse.resolve(
        new Response(JSON.stringify({
          announcement: {
            ...markdownAnnouncement,
            content: 'Edited while switch is suspended',
          },
        }), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })

    if (status === 200) {
      expect(screen.getByText('Edited while switch is suspended', { selector: 'p' })).toBeInTheDocument()
    } else {
      expect(screen.getByRole('alert')).toHaveTextContent('Pika could not confirm saving changes to this announcement.')
      expect(screen.getByRole('textbox', { name: 'Edit announcement body' })).toHaveValue('Edited while switch is suspended')
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    }
    expect(screen.getByRole('button', { name: 'Create announcement' })).toBeEnabled()
  })

  it('rolls back a teacher delete when a suspended classroom switch is abandoned', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const deleteResponse = deferred<Response>()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'DELETE') return deleteResponse.promise
        return new Response(JSON.stringify({ announcements: [markdownAnnouncement] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )

    render(<TeacherTransitionHarness />)
    await screen.findByText('Unit update')
    fireEvent.click(screen.getByRole('button', { name: 'Delete announcement' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByText('Attempt classroom switch'))

    await act(async () => {
      deleteResponse.resolve(
        new Response(JSON.stringify({ error: 'Unavailable' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })

    expect(screen.getByText('Unit update')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Pika could not confirm deleting “Unit update”.')
    expect(screen.getByRole('button', { name: 'Delete announcement' })).toBeEnabled()
    consoleError.mockRestore()
  })

  it('settles a cancelled POST without attaching its failure to a fresh create editor', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const pending = deferred<Response>()
    let writes = 0
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') { writes += 1; return pending.promise }
      return new Response(JSON.stringify({ announcements: [markdownAnnouncement] }), { status: 200 })
    }))
    render(teacherAnnouncementsElement(classroom))
    await screen.findByText('Unit update')
    fireEvent.click(screen.getByRole('button', { name: 'Create announcement' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Announcement body' }), { target: { value: 'Cancelled creation body' } })
    fireEvent.click(screen.getByRole('button', { name: 'Post', exact: true }))
    expect(screen.getByRole('textbox', { name: 'Announcement body' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }))
    await act(async () => pending.resolve(new Response('{}', { status: 500 })))
    expect(screen.queryByText('Cancelled creation body')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create announcement' }))
    const fresh = screen.getByRole('textbox', { name: 'Announcement body' })
    expect(fresh).toBeEnabled()
    expect(fresh).toHaveValue('')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.change(fresh, { target: { value: 'Fresh draft' } })
    expect(screen.getByRole('button', { name: 'Post', exact: true })).toBeEnabled()
    expect(writes).toBe(1)
  })

  it('settles a cancelled PATCH without attaching its failure to a reopened edit session', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const pending = deferred<Response>()
    let writes = 0
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PATCH') { writes += 1; return pending.promise }
      return new Response(JSON.stringify({ announcements: [markdownAnnouncement] }), { status: 200 })
    }))
    render(teacherAnnouncementsElement(classroom))
    await screen.findByText('Unit update')
    fireEvent.click(screen.getByText('bring notes'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit announcement body' }), { target: { value: 'Cancelled edit body' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }))
    expect(screen.getByRole('textbox', { name: 'Edit announcement body' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }))
    await act(async () => pending.resolve(new Response('{}', { status: 500 })))
    expect(screen.queryByText('Cancelled edit body')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('bring notes'))
    const fresh = screen.getByRole('textbox', { name: 'Edit announcement body' })
    expect(fresh).toBeEnabled()
    expect(fresh).toHaveValue(markdownAnnouncement.content)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.change(fresh, { target: { value: 'Fresh edit' } })
    expect(screen.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
    expect(writes).toBe(1)
  })

  it('marks student announcements read once per classroom', async () => {
    const markedReadUrls: string[] = []
    let resolveSecondRead: ((response: Response) => void) | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (init?.method === 'POST') {
          markedReadUrls.push(url)
          return new Response(JSON.stringify({ success: true, marked: 1 }), { status: 200 })
        }

        if (url.includes(secondClassroom.id)) {
          return new Promise<Response>((resolve) => {
            resolveSecondRead = resolve
          })
        }

        return new Response(JSON.stringify({ announcements: [markdownAnnouncement] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )

    const view = render(<StudentAnnouncementsSection classroom={classroom} />)

    await screen.findByText('Unit update')
    await waitFor(() => {
      expect(markedReadUrls).toEqual([
        `/api/student/classrooms/${classroom.id}/announcements`,
      ])
    })

    view.rerender(<StudentAnnouncementsSection classroom={secondClassroom} />)

    expect(markedReadUrls).toEqual([
      `/api/student/classrooms/${classroom.id}/announcements`,
    ])

    await act(async () => {
      resolveSecondRead?.(
        new Response(
          JSON.stringify({
            announcements: [
              {
                ...markdownAnnouncement,
                id: 'second-student-announcement',
                classroom_id: secondClassroom.id,
                title: 'Second student update',
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )
    })

    await screen.findByText('Second student update')
    await waitFor(() => {
      expect(markedReadUrls).toEqual([
        `/api/student/classrooms/${classroom.id}/announcements`,
        `/api/student/classrooms/${secondClassroom.id}/announcements`,
      ])
    })
  })
})
