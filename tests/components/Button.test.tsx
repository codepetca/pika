import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Button } from '@/ui'

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

  it.each([
    ['primary', 'bg-primary-solid', 'hover:bg-primary-solid-hover'],
    ['success', 'bg-success-solid', 'hover:bg-success-solid-hover'],
    ['danger', 'bg-danger-solid', 'hover:bg-danger-solid-hover'],
  ] as const)('should apply accessible solid fills to the %s variant', (variant, fill, hoverFill) => {
    render(<Button variant={variant}>{variant}</Button>)

    expect(screen.getByRole('button', { name: variant })).toHaveClass(fill, hoverFill, 'text-text-inverse')
  })

  it('should apply size styles', () => {
    const { container } = render(<Button size="lg">Large</Button>)
    expect(container.querySelector('button')).toHaveClass('min-h-11', 'min-w-11', 'px-6')
  })

  it('uses a keyboard-only focus treatment', () => {
    render(<Button>Continue</Button>)

    expect(screen.getByRole('button', { name: 'Continue' })).toHaveClass(
      'focus:outline-none',
      'focus-visible:ring-2',
      'focus-visible:ring-primary',
    )
  })

  it('exposes its loading state without announcing the spinner', () => {
    const { container } = render(<Button loading>Save</Button>)
    const button = screen.getByRole('button', { name: 'Save' })

    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })
})
