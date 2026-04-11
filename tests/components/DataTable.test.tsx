import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TableCard } from '@/components/DataTable'

describe('TableCard', () => {
  it('renders default chrome for standard tables', () => {
    const { container } = render(
      <TableCard>
        <div>Rows</div>
      </TableCard>,
    )

    expect(screen.getByText('Rows')).toBeInTheDocument()
    expect(container.firstChild).toHaveClass('rounded-lg', 'border', 'border-border', 'bg-surface')
  })

  it('renders flush chrome when table lives inside an outer shell', () => {
    const { container } = render(
      <TableCard chrome="flush">
        <div>Rows</div>
      </TableCard>,
    )

    expect(screen.getByText('Rows')).toBeInTheDocument()
    expect(container.firstChild).not.toHaveClass('rounded-lg')
    expect(container.firstChild).not.toHaveClass('border')
    expect(container.firstChild).not.toHaveClass('bg-surface')
    expect(container.firstChild).toHaveClass('overflow-hidden')
  })
})
