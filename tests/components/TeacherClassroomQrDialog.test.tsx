import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TeacherClassroomQrDialog } from '@/app/classrooms/[classroomId]/TeacherClassroomQrDialog'

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

describe('TeacherClassroomQrDialog', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    delete document.body.dataset.printClassroomQr
  })

  it('loads a printable stable poster and downloads the QR as SVG', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => response(presentation)))
    const print = vi.fn()
    vi.stubGlobal('print', print)
    const createObjectURL = vi.fn(() => 'blob:qr')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    render(
      <TeacherClassroomQrDialog
        classroomId="11111111-1111-4111-8111-111111111111"
        classroomTitle="Physics 11"
        isOpen
        onClose={vi.fn()}
      />,
    )

    const dialog = await screen.findByRole('dialog', { name: 'Classroom QR poster' })
    expect(within(dialog).getByLabelText('Physics 11 permanent attendance QR code')).toBeVisible()
    expect(within(dialog).getByText('Print once and use for every class')).toBeVisible()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Print' }))
    expect(document.body.dataset.printClassroomQr).toBe('true')
    expect(print).toHaveBeenCalledOnce()
    window.dispatchEvent(new Event('afterprint'))
    expect(document.body.dataset.printClassroomQr).toBeUndefined()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Download SVG' }))
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    expect(anchorClick).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:qr')
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

    render(
      <TeacherClassroomQrDialog
        classroomId="11111111-1111-4111-8111-111111111111"
        classroomTitle="Physics 11"
        isOpen
        onClose={vi.fn()}
      />,
    )

    const dialog = await screen.findByRole('dialog', { name: 'Classroom QR poster' })
    await user.click(within(dialog).getByRole('button', { name: 'Rotate QR' }))
    const confirm = screen.getByRole('dialog', { name: 'Rotate classroom QR?' })
    expect(confirm).toHaveTextContent('current poster will stop working immediately')
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
    render(
      <TeacherClassroomQrDialog
        classroomId="11111111-1111-4111-8111-111111111111"
        classroomTitle="Physics 11"
        isOpen
        onClose={vi.fn()}
      />,
    )
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
    render(<TeacherClassroomQrDialog classroomId="11111111-1111-4111-8111-111111111111" classroomTitle="Physics 11" isOpen onClose={vi.fn()} />)
    const dialog = await screen.findByRole('dialog', { name: 'Classroom QR poster' })
    await user.click(within(dialog).getByRole('button', { name: 'Rotate QR' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Rotate classroom QR?' })).getByRole('button', { name: 'Rotate QR' }))
    await screen.findByText(/Reload the current QR before printing/)
    expect(within(dialog).queryByRole('button', { name: 'Print' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Download SVG' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('img')).not.toBeInTheDocument()
    expect(document.querySelector('[data-classroom-qr-print]')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Try again' }))
    await within(dialog).findByRole('button', { name: 'Print' })
    await user.click(within(dialog).getByRole('button', { name: 'Rotate QR' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Rotate classroom QR?' })).getByRole('button', { name: 'Rotate QR' }))
    expect(JSON.parse(fetcher.mock.calls[3][1].body).expected_generation).toBe(2)
  })
})
