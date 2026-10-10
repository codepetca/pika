import { useEffect, useState } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LeftSidebar, NavItems, ThreePanelProvider, useMobileDrawer } from '@/components/layout'
import { TooltipProvider } from '@/ui'
import { TeacherClassroomJoinQrDialog } from '@/app/classrooms/[classroomId]/TeacherClassroomJoinQrDialog'
import { MobileDrawerControlsPattern } from '@/app/__ui/MobileDrawerControlsPattern'
import { ClosingFixture } from '@/app/e2e-fixtures/modal-drawer-closing/ClosingFixture'
import ClosingFixturePage from '@/app/e2e-fixtures/modal-drawer-closing/page'

describe('audited modal and navigation drawer closing', () => {
  let reduced = false
  beforeEach(() => {
    reduced = false
    vi.stubGlobal('innerWidth', 390)
    vi.useFakeTimers()
    vi.spyOn(window, 'matchMedia').mockImplementation(query => ({ matches: reduced, media: query,
      addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
      onchange: null, dispatchEvent: () => true }) as MediaQueryList)
    const original = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation(element => {
      const style = original(element)
      style.setProperty('--motion-duration-standard', '200ms')
      return style
    })
  })
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers() })

  it('restricts the fixture page in production and resolves the requested role when enabled', async () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('PIKA_E2E_FIXTURES', 'false')
    await expect(ClosingFixturePage({ searchParams: Promise.resolve({ role: 'student' }) })).rejects.toThrow()
    vi.stubEnv('PIKA_E2E_FIXTURES', 'true')
    const page = await ClosingFixturePage({ searchParams: Promise.resolve({ role: 'student' }) })
    expect(page.type).toBe(ClosingFixture); expect(page.props.role).toBe('student')
    expect((await ClosingFixturePage({})).props.role).toBe('teacher')
  })

  it('retains the last join QR passively while closing and clears it at the shared duration', () => {
    const copy = vi.fn()
    function Harness() {
      const [open, setOpen] = useState(false)
      return <><button onClick={() => setOpen(true)}>Open QR</button>
        <TeacherClassroomJoinQrDialog isOpen={open} onClose={() => setOpen(false)}
          classroomTitle={open ? 'Example classroom' : ''} joinCode={open ? 'CODE12' : ''}
          joinUrl="https://example.invalid/join/CODE12" onCopyLink={copy} />
      </>
    }
    const { container } = render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Open QR' }); opener.focus(); fireEvent.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Join this classroom' })
    const copyButton = within(dialog).getByRole('button', { name: 'Copy link' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close', exact: true }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(dialog).toBeInTheDocument()
    expect(dialog.parentElement).toHaveAttribute('aria-hidden', 'true')
    expect(dialog.parentElement!.inert).toBe(true)
    expect(within(dialog).getByText('CODE12')).toBeInTheDocument()
    expect(opener).toHaveFocus(); expect(container.inert).toBe(false)
    expect(document.body.style.overflow).toBe('')
    fireEvent.click(copyButton); expect(copy).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(200)); expect(dialog).not.toBeInTheDocument()
  })

  it.each(['teacher', 'student'] as const)('keeps full mobile %s navigation labels through close with a collapsed desktop rail', role => {
    const navigate = vi.fn()
    function Drawer() {
      const { openLeft } = useMobileDrawer()
      const nav = (expanded?: boolean) => <NavItems classroomId="synthetic" role={role}
        activeTab="announcements" onTabChange={navigate} updateSearchParams={vi.fn()} expanded={expanded} />
      return <><button onClick={openLeft}>Open navigation</button>
        <LeftSidebar exitMotion="opacity" mobileChildren={nav(true)}>{nav()}</LeftSidebar></>
    }
    const { container } = render(<TooltipProvider><ThreePanelProvider routeKey="calendar-teacher"
      initialLeftExpanded={false} persistLeftSidebar={false}><Drawer /></ThreePanelProvider></TooltipProvider>)
    const opener = screen.getByRole('button', { name: 'Open navigation' }); opener.focus(); fireEvent.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Navigation menu' })
    const link = within(dialog).getByRole('link', { name: 'Announcements', exact: true })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(dialog).toBeInTheDocument()
    expect(link.querySelector('span.truncate')).toHaveTextContent('Announcements')
    expect(opener).toHaveFocus(); expect(container.inert).toBe(false)
    fireEvent.click(link); expect(navigate).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(100)); fireEvent.click(opener)
    expect(screen.getByRole('dialog', { name: 'Navigation menu' })).toBe(dialog)
    act(() => vi.advanceTimersByTime(200)); expect(dialog).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('link', { name: 'Announcements', exact: true }))
    expect(navigate).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    act(() => vi.advanceTimersByTime(200)); expect(dialog).not.toBeInTheDocument()
  })

  it.each(['default', 'reduced'] as const)('keeps immediate drawer child cleanup for %s removal', mode => {
    reduced = mode === 'reduced'
    const retired = vi.fn()
    function Child() { useEffect(() => retired, []); return <p>Mobile child</p> }
    function Drawer() {
      const { openLeft } = useMobileDrawer()
      return <><button onClick={openLeft}>Open</button><LeftSidebar
        exitMotion={mode === 'reduced' ? 'opacity' : undefined} mobileChildren={<Child />}><p>Desktop</p></LeftSidebar></>
    }
    render(<TooltipProvider><ThreePanelProvider routeKey="calendar-teacher" initialLeftExpanded={false}
      persistLeftSidebar={false}><Drawer /></ThreePanelProvider></TooltipProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    const dialog = screen.getByRole('dialog', { name: 'Navigation menu' })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(dialog).not.toBeInTheDocument(); expect(retired).toHaveBeenCalledOnce()
  })

  it('demonstrates the production navigation owner and immediate home veto in Pattern Lab', () => {
    render(<TooltipProvider><MobileDrawerControlsPattern role="student" /></TooltipProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Block drawer home navigation' }))
    const opener = screen.getByRole('button', { name: 'Open example navigation drawer' })
    opener.focus(); fireEvent.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Navigation menu' })
    expect(within(dialog).getByRole('link', { name: 'Announcements' })).toHaveAttribute('aria-current', 'page')
    fireEvent.click(within(dialog).getByRole('link', { name: 'Classrooms', exact: true }))
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(opener).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(dialog).toBeInTheDocument()
    expect(opener).toHaveFocus()
    act(() => vi.advanceTimersByTime(200)); expect(dialog).not.toBeInTheDocument()
  })

  it.each(['teacher', 'student'] as const)('preserves the %s workspace draft and opener through fixture dismissal', role => {
    render(<TooltipProvider><ClosingFixture role={role} /></TooltipProvider>)
    const draft = screen.getByRole('textbox', { name: 'Workspace draft' })
    fireEvent.change(draft, { target: { value: 'Unsaved example' } })
    expect(screen.queryByRole('button', { name: 'Open join QR' }) !== null).toBe(role === 'teacher')
    const opener = screen.getByRole('button', { name: 'Open navigation', exact: true })
    opener.focus(); fireEvent.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Navigation menu' })
    expect(within(dialog).getByRole('link', { name: 'Announcements' })).toHaveAttribute('aria-current', 'page')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus(); expect(opener).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('textbox', { name: 'Workspace draft' })).toBe(draft)
    expect(draft).toHaveValue('Unsaved example')
    act(() => vi.advanceTimersByTime(200)); expect(dialog).not.toBeInTheDocument()
  })
})
