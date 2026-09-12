import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TeacherClassroomJoinQrDialog } from '@/app/classrooms/[classroomId]/TeacherClassroomJoinQrDialog'

describe('TeacherClassroomJoinQrDialog', () => {
  it('labels the classroom QR and shows the human-readable join code', async () => {
    const onClose = vi.fn()
    const onCopyLink = vi.fn()
    const user = userEvent.setup()
    render(
      <TeacherClassroomJoinQrDialog
        classroomTitle="Computer Science 11"
        joinCode="ICS3U2"
        joinUrl="https://pika.school/join/ICS3U2"
        isOpen
        onClose={onClose}
        onCopyLink={onCopyLink}
      />,
    )

    const dialog = screen.getByRole('dialog', { name: 'Join this classroom' })
    expect(dialog).toHaveClass('max-w-6xl', 'aspect-[2/3]', 'sm:aspect-video')
    expect(within(dialog).getByText('Computer Science 11')).toBeVisible()
    expect(within(dialog).getByText('ICS3U2')).toBeVisible()
    expect(within(dialog).getByLabelText('Computer Science 11 join classroom QR code')).toBeVisible()
    expect(within(dialog).queryByText('Student access')).not.toBeInTheDocument()
    expect(within(dialog).queryByText(/Students can scan/i)).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Copy link' }))
    expect(onCopyLink).toHaveBeenCalledOnce()
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeVisible()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })
})
