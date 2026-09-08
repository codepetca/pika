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
        attendanceHours="9:00 AM - 10:00 AM"
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

  it('loads a monitor-shaped stable poster with visible attendance actions', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => response(presentation)))
    const print = vi.fn()
    vi.stubGlobal('print', print)
    const createObjectURL = vi.fn(() => 'blob:qr')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const user = userEvent.setup()

    renderDialog()

    const dialog = await screen.findByRole('dialog', { name: 'Classroom QR' })
    expect(dialog).toHaveClass('aspect-[2/3]', 'sm:aspect-video')
    const qr = within(dialog).getByLabelText('Physics 11 permanent attendance QR code')
    expect(qr).toBeVisible()
    expect(qr).toHaveClass('max-w-64', 'sm:h-full', 'p-[10%]')
    expect(within(dialog).getByText('Physics 11')).toHaveClass('sm:text-5xl')
    expect(within(dialog).getByText('Physics 11').parentElement).toHaveClass('text-center', 'items-center')
    expect(within(dialog).getByText('Physics 11').parentElement?.parentElement)
      .toHaveClass('justify-center', 'gap-3', 'sm:gap-6')
    expect(qr.parentElement).toHaveClass('flex-none', 'sm:flex-1')
    expect(within(dialog).getByText('Scan Attendance')).toHaveClass('hidden', 'sm:block', 'sm:text-3xl')
    expect(within(dialog).getByText('9:00 AM - 10:00 AM')).toHaveClass('hidden', 'sm:block', 'sm:text-2xl')
    const optionsButton = within(dialog).getByRole('button', { name: 'QR options' })
    expect(optionsButton.closest('[class*="sm:hidden"]')).toBeTruthy()
    const settingsButton = within(dialog).getByRole('button', { name: 'Poster settings' })
    expect(settingsButton.closest('[class*="hidden"]')).toBeTruthy()
    const printLayout = document.querySelector('[data-classroom-qr-print-layout]')
    expect(printLayout).toHaveClass('flex-col', 'text-center')
    expect(printLayout?.querySelector('[data-classroom-qr-print-heading]')).toHaveTextContent('Physics 11')
    const printHours = printLayout?.querySelector('[data-classroom-qr-print-hours]')
    const printSubtitle = printLayout?.querySelector('[data-classroom-qr-print-subtitle]')
    expect(printHours).toHaveTextContent('9:00 AM - 10:00 AM')
    expect(printHours).toHaveClass('text-4xl')
    expect(printSubtitle).toHaveTextContent('Scan Attendance')
    const printQr = printLayout?.querySelector('[aria-label="Physics 11 permanent attendance QR code"]')
    expect(printQr?.compareDocumentPosition(printHours!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(printHours?.compareDocumentPosition(printSubtitle!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(document.querySelector('style[media="print"]')).toHaveTextContent('size: portrait')

    await user.click(settingsButton)
    await user.click(within(screen.getByRole('menu', { name: 'Poster settings' })).getByRole('menuitem', { name: 'Print poster' }))
    expect(document.body.dataset.printClassroomQr).toBe('true')
    expect(print).toHaveBeenCalledOnce()
    window.dispatchEvent(new Event('afterprint'))
    expect(document.body.dataset.printClassroomQr).toBeUndefined()

    await user.click(settingsButton)
    await user.click(within(screen.getByRole('menu', { name: 'Poster settings' })).getByRole('menuitem', { name: 'Download SVG' }))
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    const downloadedSvg = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.addEventListener('load', () => resolve(String(reader.result)))
      reader.addEventListener('error', () => reject(reader.error))
      reader.readAsText(createObjectURL.mock.calls[0][0] as Blob)
    })
    expect(downloadedSvg).toContain('<svg')
    expect(downloadedSvg).not.toContain('Physics 11')
    expect(downloadedSvg).not.toContain('Scan Attendance')
    expect(anchorClick).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:qr')

    await user.click(optionsButton)
    const optionsMenu = screen.getByRole('menu', { name: 'QR options' })
    expect(within(optionsMenu).getAllByRole('menuitem').map(item => item.textContent)).toEqual([
      'Print poster',
      'Download SVG',
      'Rotate QR',
    ])
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
    await user.click(within(dialog).getByRole('button', { name: 'Poster settings' }))
    await user.click(within(screen.getByRole('menu', { name: 'Poster settings' })).getByRole('menuitem', { name: 'Rotate QR' }))
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
    await user.click(within(screen.getByRole('menu', { name: 'Poster settings' })).getByRole('menuitem', { name: 'Rotate QR' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Rotate classroom QR?' })).getByRole('button', { name: 'Rotate QR' }))
    await screen.findByText(/Reload the current QR before printing/)
    expect(within(dialog).queryByRole('button', { name: 'Poster settings' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'QR options' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('img')).not.toBeInTheDocument()
    expect(document.querySelector('[data-classroom-qr-print]')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Try again' }))
    await within(dialog).findByRole('button', { name: 'Poster settings' })
    await user.click(within(dialog).getByRole('button', { name: 'Poster settings' }))
    await user.click(within(screen.getByRole('menu', { name: 'Poster settings' })).getByRole('menuitem', { name: 'Rotate QR' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Rotate classroom QR?' })).getByRole('button', { name: 'Rotate QR' }))
    expect(JSON.parse(fetcher.mock.calls[3][1].body).expected_generation).toBe(2)
  })
})
