import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FormField } from '@/ui/FormField'
import { Input } from '@/ui/Input'
import { Select } from '@/ui/Select'

describe('form control contract', () => {
  it('associates the generated label and propagates required semantics', () => {
    render(
      <FormField label="School email" required>
        <Input type="email" />
      </FormField>,
    )

    const input = screen.getByRole('textbox', { name: 'School email' })
    expect(input).toBeRequired()
    expect(input).toHaveAttribute('aria-required', 'true')
    expect(input.id).not.toBe('')
    expect(document.querySelector('label')).toHaveAttribute('for', input.id)
    expect(document.querySelector('label span')).toHaveAttribute('aria-hidden', 'true')
  })

  it('preserves a child id and merges existing, hint, and error descriptions', () => {
    render(
      <>
        <span id="format-help">Use your board address.</span>
        <FormField label="School email" hint="Use your school account." error="Email is invalid.">
          <Input id="school-email" aria-describedby="format-help" />
        </FormField>
      </>,
    )

    const input = screen.getByRole('textbox', { name: 'School email' })
    expect(input).toHaveAttribute('id', 'school-email')
    expect(input).toHaveAttribute(
      'aria-describedby',
      'format-help school-email-hint school-email-error',
    )
    expect(input).toHaveAttribute('aria-errormessage', 'school-email-error')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Use your school account.')).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('Email is invalid.')
  })

  it('adds only standard semantic attributes to native controls', () => {
    render(
      <FormField label="Reflection" error="Reflection is required.">
        <textarea />
      </FormField>,
    )

    const textarea = screen.getByRole('textbox', { name: 'Reflection' })
    expect(textarea).toHaveAttribute('aria-invalid', 'true')
    expect(textarea).not.toHaveAttribute('haserror')
  })

  it('uses an explicit htmlFor as the control id override', () => {
    render(
      <FormField label="Course code" htmlFor="course-code-field">
        <Input id="caller-id" />
      </FormField>,
    )

    expect(screen.getByRole('textbox', { name: 'Course code' })).toHaveAttribute(
      'id',
      'course-code-field',
    )
  })

  it('gives input and select controls accessible sizing and focus styles', () => {
    render(
      <>
        <Input aria-label="Name" />
        <Select aria-label="Course" options={[{ value: 'math', label: 'Math' }]} />
      </>,
    )

    for (const control of [
      screen.getByRole('textbox', { name: 'Name' }),
      screen.getByRole('combobox', { name: 'Course' }),
    ]) {
      expect(control).toHaveClass(
        'min-h-11',
        'focus:outline-none',
        'focus-visible:ring-2',
        'focus-visible:ring-primary',
      )
    }
  })
})
