import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppMessageProvider, useAppMessage, useOverlayMessage } from '@/ui'

function MessageButton({
  text,
  tone = 'info',
}: {
  text: string
  tone?: 'loading' | 'info' | 'success' | 'warning'
}) {
  const { showMessage } = useAppMessage()
  return (
    <button type="button" onClick={() => showMessage({ text, tone })}>
      Show
    </button>
  )
}

function ActiveOverlayMessage({ active }: { active: boolean }) {
  useOverlayMessage(active, 'Refreshing', { tone: 'loading', delayMs: 0 })
  return <div data-testid="stable-content">Content</div>
}

describe('AppMessageProvider', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders a fixed top-center polite status message and auto-dismisses it', () => {
    vi.useFakeTimers()

    const { container } = render(
      <AppMessageProvider>
        <MessageButton text="Saved" tone="success" />
      </AppMessageProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Show' }))

    const overlay = screen.getByTestId('app-message-overlay')
    expect(overlay).toHaveAttribute('aria-live', 'polite')
    expect(overlay).toHaveAttribute('aria-atomic', 'true')
    expect(overlay).toHaveClass('fixed', 'left-1/2', 'top-6', '-translate-y-1/2', 'pointer-events-none')
    expect(screen.getByTestId('app-message-pill')).toHaveClass('bg-surface', 'text-success')
    expect(screen.getByTestId('app-message-pill')).not.toHaveClass('bg-success-bg', 'transition-[opacity,transform]')
    expect(container.firstElementChild).toBe(screen.getByRole('button', { name: 'Show' }))
    expect(screen.getByRole('status')).toHaveTextContent('Saved')

    act(() => {
      vi.advanceTimersByTime(1800)
    })

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('replaces an older message instead of stacking messages', () => {
    vi.useFakeTimers()

    function Harness() {
      const { showMessage } = useAppMessage()
      return (
        <>
          <button type="button" onClick={() => showMessage({ text: 'First', tone: 'info' })}>
            First
          </button>
          <button type="button" onClick={() => showMessage({ text: 'Second', tone: 'warning' })}>
            Second
          </button>
        </>
      )
    }

    render(
      <AppMessageProvider>
        <Harness />
      </AppMessageProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'First' }))
    fireEvent.click(screen.getByRole('button', { name: 'Second' }))

    expect(screen.getByRole('status')).toHaveTextContent('Second')
    expect(screen.getByRole('status')).not.toHaveTextContent('First')
    expect(screen.getAllByTestId('app-message-overlay')).toHaveLength(1)
  })

  it('lets state-driven messages render outside layout content and clear when inactive', () => {
    vi.useFakeTimers()

    const { rerender } = render(
      <AppMessageProvider>
        <ActiveOverlayMessage active />
      </AppMessageProvider>,
    )

    act(() => {
      vi.advanceTimersByTime(100)
    })

    expect(screen.getByTestId('stable-content')).toHaveTextContent('Content')
    expect(screen.getByRole('status')).toHaveTextContent('Refreshing')
    expect(screen.getByTestId('app-message-overlay')).toHaveClass('fixed')

    rerender(
      <AppMessageProvider>
        <ActiveOverlayMessage active={false} />
      </AppMessageProvider>,
    )

    expect(screen.getByTestId('stable-content')).toHaveTextContent('Content')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('animates loading messages with cycling ellipsis dots', () => {
    vi.useFakeTimers()

    render(
      <AppMessageProvider>
        <MessageButton text="AI grading in progress..." tone="loading" />
      </AppMessageProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Show' }))

    expect(screen.getByRole('status')).toHaveTextContent('AI grading in progress.')

    act(() => {
      vi.advanceTimersByTime(420)
    })
    expect(screen.getByRole('status')).toHaveTextContent('AI grading in progress..')

    act(() => {
      vi.advanceTimersByTime(420)
    })
    expect(screen.getByRole('status')).toHaveTextContent('AI grading in progress...')
  })
})
