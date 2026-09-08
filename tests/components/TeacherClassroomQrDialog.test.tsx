import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TeacherClassroomQrDialog } from '@/app/classrooms/[classroomId]/TeacherClassroomQrDialog'
import { TooltipProvider } from '@/ui'

const token = 'a'.repeat(43)
const presentation = {
  entryPath: `/attendance/classroom/${token}`,
  generation: 1,
  rotatedAt: '2026-09-01T12:00:00.000Z',
}

function response(body: unknown, ok = true) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status: ok ? 200 : 503,
    headers: { 'Content-Type': 'application/json' },
  }))
}

function renderDialog() {
  return render(
    <TooltipProvider>
      <TeacherClassroomQrDialog
        classroomId="11111111-1111-4111-8111-111111111111"
        classroomTitle="Physics 11"
        isOpen
        onClose={vi.fn()}
      />
    </TooltipProvider>,
  )
}

describe('TeacherClassroomQrDialog', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    delete document.body.dataset.printClassroomQr
  })

  it('loads a monitor-shaped stable poster and prints from its settings menu', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => response(presentation)))
    const print = vi.fn()
    vi.stubGlobal('print', print)
    const user = userEvent.setup()

    renderDialog()

    const dialog = await screen.findByRole('dialog', { name: 'Classroom QR' })
    const qr = within(dialog).getByLabelText('Physics 11 permanent attendance QR code')
    expect(qr).toBeVisible()
    expect(qr).toHaveClass('sm:h-full', 'p-[10%]')
    expect(within(dialog).getByText('Physics 11')).toHaveClass('sm:text-4xl')
    expect(within(dialog).getByText('Stable until you rotate it')).toBeVisible()
    expect(within(dialog).queryByRole('button', { name: 'Print poster' })).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Poster settings' }))
    await user.click(within(dialog).getByRole('menuitem', { name: 'Print poster' }))
    expect(document.body.dataset.printClassroomQr).toBe('true')
    expect(print).toHaveBeenCalledOnce()
    window.dispatchEvent(new Event('afterprint'))
    expect(document.body.dataset.printClassroomQr).toBeUndefined()
  })

  it('warns that rotation invalidates the old poster and replaces it after confirmation', async () => {
    const rotated = {
      entryPath: `/attendance/classroom/${'b'.repeat(43)}`,
      generation: 2,
      rotatedAt: '2026-09-01T13:00:00.000Z',
    }
    const fetcher = vi.fn()
      .mockImplementationOnce(() => response(presentation))
      .mockImplementationOnce(() => response(rotated))
    vi.stubGlobal('fetch', fetcher)
    const user = userEvent.setup()

    renderDialog()

    const dialog = await screen.findByRole('dialog', { name: 'Classroom QR' })
    expect(within(dialog).queryByRole('button', { name: 'Rotate QR' })).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Poster settings' }))
    await user.click(within(dialog).getByRole('menuitem', { name: 'Rotate QR' }))
    const confirm = screen.getByRole('dialog', { name: 'Rotate classroom QR?' })
    expect(confirm).toHaveTextContent('current printed poster will stop working immediately')
    await user.click(within(confirm).getByRole('button', { name: 'Rotate QR' }))

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    expect(fetcher.mock.calls[1][0]).toBe('/api/teacher/attendance/classroom-qr')
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
      classroom_id: '11111111-1111-4111-8111-111111111111',
      expected_generation: 1,
    })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Rotate classroom QR?' }))
      .not.toBeInTheDocument())
  })

  it('shows a recoverable loading failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => response({ error: 'down' }, false)))
    renderDialog()
    expect(await screen.findByRole('heading', { name: 'Classroom QR unavailable' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible()
  })

  it.each(['lost response', 'concurrent rotation'] as const)('requires an authoritative reload after %s', async failure => {
    const current = { ...presentation, entryPath: `/attendance/classroom/${'b'.repeat(43)}`, generation: 2 }
    const fetcher = vi.fn()
      .mockImplementationOnce(() => response(presentation))
      .mockImplementationOnce(() => failure === 'lost response'
        ? Promise.reject(new TypeError('network failed'))
        : Promise.resolve(new Response(JSON.stringify({ error: 'The classroom QR changed' }), { status: 409 })))
      .mockImplementationOnce(() => response(current))
      .mockImplementationOnce(() => response({ ...current, generation: 3 }))
    vi.stubGlobal('fetch', fetcher)
    const user = userEvent.setup()
    renderDialog()
    const dialog = await screen.findByRole('dialog', { name: 'Classroom QR' })
    await user.click(within(dialog).getByRole('button', { name: 'Poster settings' }))
    await user.click(within(dialog).getByRole('menuitem', { name: 'Rotate QR' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Rotate classroom QR?' })).getByRole('button', { name: 'Rotate QR' }))
    await screen.findByText(/Reload the current QR before printing/)
    expect(within(dialog).queryByRole('button', { name: 'Print poster' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Poster settings' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('img')).not.toBeInTheDocument()
    expect(document.querySelector('[data-classroom-qr-print]')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Try again' }))
    await within(dialog).findByRole('button', { name: 'Poster settings' })
    await user.click(within(dialog).getByRole('button', { name: 'Poster settings' }))
    await user.click(within(dialog).getByRole('menuitem', { name: 'Rotate QR' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Rotate classroom QR?' })).getByRole('button', { name: 'Rotate QR' }))
    expect(JSON.parse(fetcher.mock.calls[3][1].body).expected_generation).toBe(2)
  })
})
