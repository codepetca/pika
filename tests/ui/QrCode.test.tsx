import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { QrCode } from '@/ui'

describe('QrCode', () => {
  it('retains its accessible name and default size', () => {
    render(<QrCode value="https://example.invalid" label="Attendance QR" />)
    const code = screen.getByRole('img', { name: 'Attendance QR' })
    expect(code.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(code.querySelector('svg')).toHaveClass('max-w-64')
  })

  it('supports a square full-size presentation without changing its label', () => {
    render(<QrCode value="https://example.invalid" label="Poster QR" className="aspect-square" codeClassName="max-w-none" />)
    const code = screen.getByRole('img', { name: 'Poster QR' })
    expect(code).toHaveClass('aspect-square')
    expect(code.querySelector('svg')).toHaveClass('max-w-none')
    expect(code.querySelector('svg')).not.toHaveClass('max-w-64')
  })
})
