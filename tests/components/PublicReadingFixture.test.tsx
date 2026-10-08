import { render, screen, within, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('not found') } }))
vi.mock('@/lib/server/course-sites', () => ({ buildMarkdownSectionContent: (markdown: string) => markdown }))
vi.mock('@/components/editor/RichTextViewer', () => ({ RichTextViewer: ({ content }: { content: string }) => <div>{content}</div> }))
import PublicReadingFixture from '@/app/e2e-fixtures/public-reading/page'
import { finalLesson, finalTest } from '@/app/e2e-fixtures/public-reading/data'

const originalEnv = { ...process.env }
afterEach(() => { cleanup(); vi.unstubAllEnvs(); process.env = { ...originalEnv } })
const page = (variant: string) => PublicReadingFixture({ searchParams: Promise.resolve({ variant }) })
function enable() { vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('PIKA_E2E_FIXTURES', 'true') }

describe('PublicReadingFixture', () => {
  it('requires both nonproduction runtime and explicit fixture flag', async () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('PIKA_E2E_FIXTURES', 'true')
    await expect(page('planned-long')).rejects.toThrow('not found')
    vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('PIKA_E2E_FIXTURES', 'false')
    await expect(page('actual-long')).rejects.toThrow('not found')
    enable(); await expect(page('unknown')).rejects.toThrow('not found')
  })
  it('preserves the original Planned presentation body byte for byte', () => {
    const base = execFileSync('git', ['show', '47659857d0ce39431cda46faa0426fd520912025:src/app/planned/[slug]/page.tsx'], { encoding: 'utf8' })
    const owner = readFileSync('src/app/planned/PlannedCourseDocument.tsx', 'utf8')
    expect(owner.slice(owner.indexOf('  const config ='))).toBe(base.slice(base.indexOf('  const config =')))
    const constants = base.slice(base.indexOf('const sectionClassName'), base.indexOf('export default'))
    expect(owner).toContain(constants)
  })
  it('keeps final-only Planned nav and rendered sections in correspondence', async () => {
    enable(); const { container } = render(await page('planned-final'))
    const links = within(screen.getByRole('navigation', { name: 'Course sections' })).getAllByRole('link')
    expect(links.map(link => link.getAttribute('href'))).toEqual(['#lesson-sequence'])
    expect(Array.from(container.querySelectorAll('section')).map(section => section.id)).toEqual(['lesson-sequence'])
    expect(screen.getByText(finalLesson)).toBeInTheDocument()
  })
  it('retains Planned all-empty owner semantics', async () => {
    enable(); const { container } = render(await page('planned-empty'))
    expect(container.querySelectorAll('section')).toHaveLength(0)
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Planned sparse reading fixture')
  })
  it('uses actual title-only Tests and intentionally absent Resources', async () => {
    enable(); render(await page('actual-tests'))
    expect(screen.getByText(finalTest)).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.queryByRole('heading', { name: 'Resources' })).toBeNull()
  })
  it.each(['actual-empty', 'actual-resources'])('uses the actual empty owner for %s', async variant => {
    enable(); render(await page(variant))
    expect(screen.getByText('Course guide details are being prepared.')).toBeInTheDocument()
    expect(screen.queryByText('Legacy resource intentionally absent')).toBeNull()
  })
})
