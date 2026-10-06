import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import TeacherBlueprintsFixturePage from '@/app/e2e-fixtures/teacher-blueprints/page'

const notFound = vi.hoisted(() => vi.fn(() => { throw new Error('NOT_FOUND') }))
vi.mock('next/navigation', () => ({ notFound }))
vi.mock('@/app/teacher/blueprints/page', () => ({
  default: () => <div>Blueprint production owner</div>,
}))

afterEach(() => {
  vi.unstubAllEnvs()
  notFound.mockClear()
})

describe('TeacherBlueprintsFixturePage gate', () => {
  it('rejects production even when the fixture flag is enabled', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('PIKA_E2E_FIXTURES', 'true')
    expect(() => TeacherBlueprintsFixturePage()).toThrow('NOT_FOUND')
  })

  it('rejects development without the explicit fixture flag', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('PIKA_E2E_FIXTURES', 'false')
    expect(() => TeacherBlueprintsFixturePage()).toThrow('NOT_FOUND')
  })

  it('mounts the existing owner only in the enabled development fixture', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('PIKA_E2E_FIXTURES', 'true')
    render(TeacherBlueprintsFixturePage())
    expect(screen.getByText('Blueprint production owner')).toBeVisible()
    expect(notFound).not.toHaveBeenCalled()
  })
})
