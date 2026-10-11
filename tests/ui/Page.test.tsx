import { createRef, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { TooltipProvider } from '@/ui'
import { act, fireEvent, render as renderRTL, screen, waitFor, within } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ACTIONBAR_BUTTON_CLASSNAME,
  ACTIONBAR_ICON_BUTTON_CLASSNAME,
  PageActionBar,
  PageContent,
  PageHeading,
  PageLayout,
  PageStack,
} from '@/ui'

function render(ui: ReactNode) { return renderRTL(<TooltipProvider>{ui}</TooltipProvider>) }

describe('Page primitives', () => {
  it('supports intentional heading focus without adding it to the Tab order', () => {
    const headingRef = createRef<HTMLHeadingElement>()
    render(<PageHeading title="Active classrooms" size="section" headingRef={headingRef} tabIndex={-1} />)
    headingRef.current?.focus()
    expect(screen.getByRole('heading', { name: 'Active classrooms' })).toHaveFocus()
    expect(headingRef.current).toHaveAttribute('tabindex', '-1')
  })
  it('applies canonical content widths without feature-local max-width classes', () => {
    const { rerender } = render(<PageLayout width="reading">Content</PageLayout>)

    expect(screen.getByText('Content')).toHaveClass('max-w-reading', 'mx-auto', 'w-full')

    rerender(<PageLayout width="standard">Content</PageLayout>)
    expect(screen.getByText('Content')).toHaveClass('max-w-standard')
  })

  it('preserves legacy className width overrides during migration', () => {
    render(<PageLayout className="mx-auto max-w-7xl">Legacy width</PageLayout>)

    expect(screen.getByText('Legacy width')).toHaveClass('mx-auto', 'max-w-7xl')
    expect(screen.getByText('Legacy width')).not.toHaveClass('max-w-none')
  })

  it('propagates the selected density to content gutters and stack spacing', () => {
    render(
      <PageLayout density="teacher">
        <PageContent>
          <PageStack>Dense teacher content</PageStack>
        </PageContent>
      </PageLayout>,
    )

    const stack = screen.getByText('Dense teacher content')
    expect(stack).toHaveClass('space-y-density-compact-stack-gap')
    expect(stack.parentElement).toHaveClass(
      'px-density-compact-gutter',
      'pt-density-compact-content-top',
    )
  })

  it('provides semantic page and section heading levels with governed typography', () => {
    const { rerender } = render(<PageHeading title="Classrooms" description="Current courses" />)

    expect(screen.getByRole('heading', { level: 1, name: 'Classrooms' })).toHaveClass(
      'text-2xl',
      'font-semibold',
    )
    expect(screen.getByText('Current courses')).toHaveClass('text-sm')

    rerender(<PageHeading level="h2" size="section" title="Archived" />)
    expect(screen.getByRole('heading', { level: 2, name: 'Archived' })).toHaveClass(
      'text-sm',
      'font-semibold',
    )
  })

  it('preserves default truncation and opts reading headings into natural wrapping', () => {
    const title = 'Environmental science and community inquiry — distinctive course identity'
    const { rerender } = render(<PageHeading title={title} />)
    expect(screen.getByRole('heading', { level: 1, name: title })).toHaveClass('truncate')
    rerender(<PageHeading title={title} wrap />)
    const heading = screen.getByRole('heading', { level: 1, name: title })
    expect(heading).not.toHaveClass('truncate')
    expect(heading).toHaveClass('whitespace-normal', 'text-2xl', 'leading-8')
  })

  it('keeps the title and overflow action in one stable row', () => {
    render(
      <PageActionBar
        primary={<PageHeading title="Classrooms" />}
        actions={[{ id: 'join', label: 'Join classroom', onSelect: vi.fn() }]}
      />,
    )

    const row = screen.getByRole('heading', { name: 'Classrooms' }).parentElement?.parentElement
      ?.parentElement
    expect(row).toHaveClass('flex', 'items-center', 'gap-3')
    expect(
      screen.getByRole('button', { name: 'More actions' }).parentElement?.parentElement?.parentElement,
    ).toHaveClass('flex', 'items-center', 'gap-3')
    expect(screen.getByRole('button', { name: 'More actions' })).toHaveClass(
      'border-transparent',
      'bg-transparent',
      'text-text-muted',
    )
  })

  it('preserves 44px targets and focus treatment for action buttons and menu items', () => {
    expect(ACTIONBAR_BUTTON_CLASSNAME).toContain('min-h-control')
    expect(ACTIONBAR_BUTTON_CLASSNAME).not.toContain('min-h-10')
    expect(ACTIONBAR_ICON_BUTTON_CLASSNAME).toContain('h-11')
    expect(ACTIONBAR_ICON_BUTTON_CLASSNAME).toContain('w-11')

    render(
      <PageActionBar
        primary="Actions"
        actions={[{ id: 'archive', label: 'Archive', onSelect: vi.fn() }]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))

    const item = within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Archive' })
    expect(item).toHaveClass(
      'min-h-control',
      'focus-visible:ring-foundation',
      'focus-visible:ring-inset',
    )
  })

  it('does not reclaim focus with menu keys after focus leaves the open menu', async () => {
    const user = userEvent.setup()
    render(
      <>
        <PageActionBar
          primary="Actions"
          actions={[{ id: 'archive', label: 'Archive', onSelect: vi.fn() }]}
        />
        <button type="button">After menu</button>
      </>,
    )

    await user.click(screen.getByRole('button', { name: 'More actions' }))
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Archive' })).toHaveFocus())

    await user.tab()
    const nextAction = screen.getByRole('button', { name: 'After menu' })
    expect(nextAction).toHaveFocus()

    await user.keyboard('{ArrowDown}{Escape}')

    expect(nextAction).toHaveFocus()
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })
})


describe('Page action menu closing lifetime', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

  function motion(duration = '150ms', reduced = false) {
    vi.useFakeTimers()
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ getPropertyValue: () => duration } as unknown as CSSStyleDeclaration)
    const media = new EventTarget() as EventTarget & { matches: boolean }
    media.matches = reduced
    vi.spyOn(window, 'matchMedia').mockReturnValue(media as unknown as MediaQueryList)
    return media
  }

  it('retires commands and focus immediately, retaining an inert fast exit until expiry', () => {
    motion()
    const command = vi.fn()
    render(<PageActionBar primary="Actions" actions={[{ id: 'archive', label: 'Archive', onSelect: command }]} />)
    const trigger = screen.getByRole('button', { name: 'More actions' })
    fireEvent.click(trigger)
    const menu = screen.getByRole('menu')
    const item = screen.getByRole('menuitem')
    fireEvent.keyDown(item, { key: 'Escape' })
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(menu).toBeInTheDocument()
    expect(menu).toHaveAttribute('aria-hidden', 'true')
    expect(menu.inert).toBe(true)
    fireEvent.click(item)
    fireEvent.keyDown(item, { key: 'Enter' })
    fireEvent.pointerDown(item)
    expect(command).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(149))
    expect(menu).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(1))
    expect(menu).not.toBeInTheDocument()
  })

  it('does not resurrect an all-disabled menu when availability returns', () => {
    const command = vi.fn()
    const view = (disabled: boolean) => <PageActionBar primary="Actions" actions={[{ id: 'archive', label: 'Archive', onSelect: command, disabled }]} />
    const { rerender } = render(view(false))
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    rerender(<TooltipProvider>{view(true)}</TooltipProvider>)
    rerender(<TooltipProvider>{view(false)}</TooltipProvider>)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'More actions' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('rapid reopen cancels an old exit and uses current enabled keyboard order and matching IDs', () => {
    motion('0.15s')
    render(<PageActionBar primary="Actions" actions={[
      { id: 'first', label: 'First', onSelect: vi.fn() },
      { id: 'disabled', label: 'Disabled', disabled: true, onSelect: vi.fn() },
      { id: 'last', label: 'Delete', destructive: true, onSelect: vi.fn() },
    ]} />)
    const trigger = screen.getByRole('button', { name: 'More actions' })
    fireEvent.click(trigger)
    expect(screen.getByRole('menu')).toHaveAttribute('id', trigger.getAttribute('aria-controls'))
    expect(screen.getByRole('menuitem', { name: 'First' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Home' })
    expect(screen.getByRole('menuitem', { name: 'First' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'End' })
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus()
    fireEvent.click(trigger)
    act(() => vi.advanceTimersByTime(75))
    fireEvent.click(trigger)
    act(() => vi.advanceTimersByTime(150))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'First' })).toHaveFocus()
  })

  it.each(['callback', 'label', 'disabled', 'empty'] as const)('clears retained presentation immediately on %s owner updates', (change) => {
    motion()
    const command = vi.fn()
    const original = { id: 'action', label: 'Original', onSelect: command }
    const view = (actions: typeof original[]) => <TooltipProvider><PageActionBar primary="Actions" actions={actions} /></TooltipProvider>
    const { rerender } = renderRTL(view([original]))
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    const menu = screen.getByRole('menu')
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(menu).toBeInTheDocument()
    const changed = change === 'callback' ? { ...original, onSelect: vi.fn() } : change === 'label' ? { ...original, label: 'New owner' } : { ...original, disabled: true }
    rerender(view(change === 'empty' ? [] : [changed]))
    expect(menu).not.toBeInTheDocument()
    act(() => vi.advanceTimersByTime(200))
    expect(command).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it.each(['0ms', 'invalid', '-1ms'])('removes immediately for the semantic duration %s', (duration) => {
    motion(duration)
    render(<PageActionBar primary="Actions" actions={[{ id: 'action', label: 'Action', onSelect: vi.fn() }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    const menu = screen.getByRole('menu')
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(menu).not.toBeInTheDocument()
  })

  it.each([true, false])('respects reduced motion at close or during exit (initial: %s)', (initial) => {
    const media = motion('150ms', initial)
    render(<PageActionBar primary="Actions" actions={[{ id: 'action', label: 'Action', onSelect: vi.fn() }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    const menu = screen.getByRole('menu')
    fireEvent.keyDown(menu, { key: 'Escape' })
    if (!initial) {
      expect(menu).toBeInTheDocument()
      act(() => { media.matches = true; media.dispatchEvent(new Event('change')) })
    }
    expect(menu).not.toBeInTheDocument()
  })

  it('blocks reentrant command dispatch before React commits dismissal', () => {
    motion()
    const otherCommand = vi.fn()
    let staleItem: HTMLElement
    const command = vi.fn(() => { fireEvent.click(staleItem) })
    render(<PageActionBar primary="Actions" actions={[
      { id: 'first', label: 'First', onSelect: command },
      { id: 'other', label: 'Other', onSelect: otherCommand },
    ]} />)
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    staleItem = screen.getByRole('menuitem', { name: 'Other' })
    fireEvent.click(screen.getByRole('menuitem', { name: 'First' }))
    expect(command).toHaveBeenCalledOnce()
    expect(otherCommand).not.toHaveBeenCalled()
  })

  it('retires outside dismissal and pending motion when unmounted', () => {
    const media = motion()
    const removeMedia = vi.spyOn(media, 'removeEventListener')
    const { unmount } = render(<><PageActionBar primary="Actions" actions={[{ id: 'action', label: 'Action', onSelect: vi.fn() }]} /><button>Outside</button></>)
    const trigger = screen.getByRole('button', { name: 'More actions' })
    fireEvent.click(trigger)
    const menu = screen.getByRole('menu')
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Outside' }))
    expect(trigger).toHaveFocus()
    screen.getByRole('button', { name: 'Outside' }).focus()
    fireEvent.mouseDown(document.body)
    expect(screen.getByRole('button', { name: 'Outside' })).toHaveFocus()
    unmount()
    expect(menu).not.toBeInTheDocument()
    expect(removeMedia).toHaveBeenCalledWith('change', expect.any(Function))
    act(() => vi.advanceTimersByTime(200))
  })

  it('lets dialog focus win selection handoff without a delayed focus return', () => {
    motion()
    function Handoff() {
      const [dialog, setDialog] = useState(false)
      const focus = useRef<HTMLButtonElement>(null)
      useLayoutEffect(() => { if (dialog) focus.current?.focus() }, [dialog])
      return <><PageActionBar primary="Actions" actions={[{ id: 'dialog', label: 'Open dialog', onSelect: () => setDialog(true) }]} />{dialog && <div role="dialog"><button ref={focus}>Dialog action</button></div>}</>
    }
    render(<Handoff />)
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByRole('menuitem'))
    expect(screen.getByRole('button', { name: 'Dialog action' })).toHaveFocus()
    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByRole('button', { name: 'Dialog action' })).toHaveFocus()
  })

  it('defers client-owned ID relationships in server markup', () => {
    const html = renderToString(<TooltipProvider><PageActionBar primary="Actions" actions={[{ id: 'action', label: 'Action', onSelect: vi.fn() }]} /></TooltipProvider>)
    expect(html).not.toContain('aria-controls=')
    expect(html).toContain('aria-expanded="false"')
  })


  it('hydrates differing server/client ID paths without a stale trigger relationship', async () => {
    const ui = <TooltipProvider><PageActionBar primary="Actions" actions={[{ id: 'action', label: 'Action', onSelect: vi.fn() }]} /></TooltipProvider>
    const container = document.createElement('div')
    container.innerHTML = renderToString(ui, { identifierPrefix: 'server-' })
    document.body.appendChild(container)
    expect(container.querySelector('[aria-label="More actions"]')).not.toHaveAttribute('aria-controls')
    const recoverable = vi.fn()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    let root: ReturnType<typeof hydrateRoot>
    await act(async () => { root = hydrateRoot(container, ui, { identifierPrefix: 'client-', onRecoverableError: recoverable }) })
    try {
      const trigger = within(container).getByRole('button', { name: 'More actions' })
      fireEvent.click(trigger)
      const menu = within(container).getByRole('menu')
      expect(trigger).toHaveAttribute('aria-controls', menu.id)
      expect(menu.id).toContain('client-')
      expect(recoverable).not.toHaveBeenCalled()
      expect(consoleError).not.toHaveBeenCalled()
    } finally {
      act(() => root!.unmount())
      container.remove()
    }
  })

})
