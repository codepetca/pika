import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Select } from '@/ui'
import { normalizeGitHubRepoUrl } from '@/lib/github-repos'

describe('Select', () => {
  it('renders placeholder and options with the expected disabled states', () => {
    render(
      <Select
        aria-label="Repository type"
        placeholder="Choose one"
        options={[
          { value: 'private', label: 'Private' },
          { value: 'public', label: 'Public', disabled: true },
        ]}
        defaultValue=""
      />
    )

    const select = screen.getByRole('combobox', { name: 'Repository type' })
    expect(select).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Choose one' })).toBeDisabled()
    expect(screen.getByRole('option', { name: 'Private' })).toBeEnabled()
    expect(screen.getByRole('option', { name: 'Public' })).toBeDisabled()
  })

  it('forwards change events through the rendered select element', () => {
    render(
      <Select
        aria-label="Visibility"
        options={[
          { value: 'private', label: 'Private' },
          { value: 'public', label: 'Public' },
        ]}
        defaultValue="private"
      />
    )

    const select = screen.getByRole('combobox', { name: 'Visibility' })
    fireEvent.change(select, { target: { value: 'public' } })

    expect(select).toHaveValue('public')
  })
})

describe('normalizeGitHubRepoUrl', () => {
  it('normalizes valid GitHub references to the canonical repo URL', () => {
    expect(normalizeGitHubRepoUrl('codepetca/pika.git')).toBe('https://github.com/codepetca/pika')
    expect(normalizeGitHubRepoUrl('https://www.github.com/codepetca/pika')).toBe(
      'https://github.com/codepetca/pika'
    )
  })

  it('returns null for invalid repository references', () => {
    expect(normalizeGitHubRepoUrl('not a repo')).toBeNull()
  })
})
