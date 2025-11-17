import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Button } from '@/components/Button'

describe('Button component', () => {
  it('should render with children', () => {
    render(<Button>Click me</Button>)
    expect(screen.getByText('Click me')).toBeInTheDocument()
  })

  it('should handle click events', () => {
    const handleClick = vi.fn()
    render(<Button onClick={handleClick}>Click me</Button>)

    fireEvent.click(screen.getByText('Click me'))
    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it('should be disabled when disabled prop is true', () => {
    render(<Button disabled>Click me</Button>)
    const button = screen.getByText('Click me')

    expect(button).toBeDisabled()
  })

  it('should not call onClick when disabled', () => {
    const handleClick = vi.fn()
    render(<Button disabled onClick={handleClick}>Click me</Button>)

    fireEvent.click(screen.getByText('Click me'))
    expect(handleClick).not.toHaveBeenCalled()
  })

  it('should apply variant styles', () => {
    const { container } = render(<Button variant="primary">Primary</Button>)
    expect(container.querySelector('button')).toHaveClass('bg-blue-600')
  })

  it('should apply size styles', () => {
    const { container } = render(<Button size="lg">Large</Button>)
    expect(container.querySelector('button')).toHaveClass('px-6')
  })
})
