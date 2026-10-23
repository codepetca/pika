import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TestPublicationControl } from '@/components/test-workspace/TestPublicationControl'
import { TooltipProvider } from '@/ui'
import { createMockTest } from '../helpers/mocks'
import { getTodayInToronto } from '@/lib/timezone'

afterEach(() => vi.unstubAllGlobals())

function setup(status: 'draft' | 'closed' = 'draft', canUnpublish = false) {
  const test = createMockTest({ status, test_date: status === 'closed' ? '2026-10-20' : null })
  const onPublish = vi.fn(async () => true)
  const onUnpublish = vi.fn()
  const onSaved = vi.fn()
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => ({ ok: true, json: async (): Promise<unknown> => ({ test: { ...test, ...JSON.parse(init.body as string) } }) }))
  vi.stubGlobal('fetch', fetchMock)
  render(<TooltipProvider><TestPublicationControl test={test} classroomId={test.classroom_id} apiBasePath="/api/teacher/tests" onPublish={onPublish} onSaved={onSaved} onUnpublish={onUnpublish} canUnpublish={canUnpublish} allowFutureDate={canUnpublish || status === 'draft'} /></TooltipProvider>)
  return { onPublish, onUnpublish, onSaved, fetchMock }
}

describe('TestPublicationControl', () => {
  it('saves Toronto today before requesting immediate publication', async () => {
    const { onPublish, fetchMock } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Publish today' }))
    await waitFor(() => expect(onPublish).toHaveBeenCalledOnce())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ test_date: getTodayInToronto() })
  })

  it('chooses a future date before requesting scheduled publication', async () => {
    const { onPublish, fetchMock } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Schedule test' }))
    const dialog = screen.getByRole('dialog', { name: 'Schedule test' })
    fireEvent.change(within(dialog).getByLabelText('Test date'), { target: { value: '2099-11-08' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Schedule' }))
    await waitFor(() => expect(onPublish).toHaveBeenCalledOnce())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ test_date: '2099-11-08' })
  })

  it('keeps a failed date save editable and never publishes', async () => {
    const { onPublish, fetchMock } = setup()
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Date save failed' }) })
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Publish today' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Date save failed')
    expect(onPublish).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Publish' })).toBeEnabled()
  })

  it('offers date changes and only valid unpublishing from the published date', () => {
    const { onUnpublish } = setup('closed', true)
    fireEvent.click(screen.getByRole('button', { name: /Test date:/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unpublish' }))
    expect(onUnpublish).toHaveBeenCalledOnce()
  })

  it('disables future rescheduling and unpublishing once work has started', () => {
    setup('closed')
    fireEvent.click(screen.getByRole('button', { name: /Test date:/ }))
    expect(screen.getByRole('menuitem', { name: 'Unpublish' })).toBeDisabled()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Change date' }))
    expect(screen.getByLabelText('Test date')).toHaveAttribute('max', getTodayInToronto())
  })

  it('does not publish after the editor starts closing during a date save', async () => {
    const test = createMockTest({ status: 'draft', test_date: null })
    let finish!: (value: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve })))
    const onPublish = vi.fn()
    const props = { test, classroomId: test.classroom_id, apiBasePath: '/api/teacher/tests', onPublish, onSaved: vi.fn() }
    const view = render(<TooltipProvider><TestPublicationControl {...props} /></TooltipProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Publish today' }))
    view.rerender(<TooltipProvider><TestPublicationControl {...props} disabled /></TooltipProvider>)
    finish({ ok: true, json: async () => ({ test: { ...test, test_date: getTodayInToronto() } }) } as Response)
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledOnce())
    expect(onPublish).not.toHaveBeenCalled()
  })

  it('discards a failed date change on Cancel so closing the editor cannot retry it', async () => {
    const test = createMockTest({ status: 'closed', test_date: '2026-10-20' })
    const fetchMock = vi.fn(async () => ({ ok: false, json: async () => ({ error: 'Date save failed' }) }))
    vi.stubGlobal('fetch', fetchMock)
    let flush: (() => Promise<boolean>) | null = null
    render(<TooltipProvider><TestPublicationControl test={test} classroomId={test.classroom_id} apiBasePath="/api/teacher/tests"
      onSaved={vi.fn()} allowFutureDate onFlushReady={ready => { flush = ready }} /></TooltipProvider>)
    fireEvent.click(screen.getByRole('button', { name: /Test date:/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Change date' }))
    fireEvent.change(screen.getByLabelText('Test date'), { target: { value: '2099-11-08' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save date' }))
    expect(await screen.findByText('Date save failed')).toBeInTheDocument()
    const cornerClose = screen.getByRole('button', { name: 'Close', exact: true })
    expect(cornerClose.closest('[data-dialog-close]')).toHaveClass('right-3', 'top-3')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await flush?.()
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
