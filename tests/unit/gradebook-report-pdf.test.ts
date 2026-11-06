import { unzipSync, strFromU8 } from 'fflate'
import { PDFDocument } from 'pdf-lib'
import { extractText } from 'pdfnative'
import { describe, expect, it } from 'vitest'
import { buildGradebookReportArchive } from '@/lib/gradebook-report-pdf'

describe('gradebook report archive', () => {
  it('creates one independent PDF per student, including duplicate names', async () => {
    const report = { studentName: 'Élodie Smith', currentPercent: 80, items: [] }
    const files = unzipSync(await buildGradebookReportArchive('Course', [report, report]))
    expect(Object.keys(files)).toHaveLength(2)
    for (const bytes of Object.values(files)) expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1)
  })
  it('fails rather than silently replacing unsupported characters', async () => {
    await expect(buildGradebookReportArchive('Course', [{ studentName: '🦄', currentPercent: null, items: [] }])).rejects.toThrow('cannot display')
  })
  it('keeps multilingual names and titles as text in separate student reports', async () => {
    const reports = [
      { studentName: '學生 中文', currentPercent: 80, items: [] },
      { studentName: 'محمد أحمد', currentPercent: 70, items: [] },
      { studentName: 'कृष्ण हिन्दी', currentPercent: 60, items: [] },
    ]
    const files = Object.values(unzipSync(await buildGradebookReportArchive('Course', reports)))
    expect(files).toHaveLength(3)
    for (let i = 0; i < reports.length; i++) {
      const text = extractText(files[i]).map((page) => page.text).join('\n')
      expect(text).toContain(reports[i].studentName)
      for (const other of reports.filter((_, j) => i !== j)) expect(text).not.toContain(other.studentName)
    }
  })
  it('pairs each PDF with only its own guardian and protects spreadsheet cells', async () => {
    const reports = [{ studentName: '=First Student', currentPercent: 80, items: [] }, { studentName: 'Second Student', currentPercent: 70, items: [] }]
    const files = unzipSync(await buildGradebookReportArchive('Course', reports, [
      { email: 'guardian@example.com', status: 'Review address' }, { email: '', status: 'Missing guardian email' },
    ]))
    const csv = strFromU8(files['guardian-recipients.csv'])
    expect(csv).toContain('"001 - =First Student.pdf","\'=First Student","guardian@example.com","Review address"')
    expect(csv).toContain('"002 - Second Student.pdf","Second Student","","Missing guardian email"')
    const first = extractText(files['001 - =First Student.pdf']).map((page) => page.text).join('\n')
    expect(first).not.toContain('Second Student')
    expect(first).not.toContain('guardian@example.com')
  })
  it('does not create a trailing page containing only a disclaimer', async () => {
    const item = { title: 'Short item', kind: 'Classwork' as const, categoryName: 'Term Work', earned: 18, possible: 20, percent: 90, included: true, isZeroWeight: false }
    const files = unzipSync(await buildGradebookReportArchive('Course', [{ studentName: 'Student', currentPercent: 90, items: Array(10).fill(item) }]))
    const pages = extractText(Object.values(files)[0])
    expect(pages.length).toBeGreaterThan(0)
    for (const page of pages) expect(page.text).toContain('Short item')
  })
  it('keeps long multilingual titles and later marks across pages', async () => {
    const title = '中文測驗'.repeat(600)
    const item = { title, kind: 'Classwork' as const, categoryName: null, earned: 8, possible: 10, percent: 80, included: true, isZeroWeight: false }
    const files = unzipSync(await buildGradebookReportArchive('Course', [{ studentName: 'Student', currentPercent: 80, items: [item, { ...item, title: 'Final item' }] }]))
    const pages = extractText(Object.values(files)[0])
    expect(pages.length).toBeGreaterThan(1)
    const text = pages.map((page) => page.text.replace(/Pika\s*·\s*Gradebook report\s*Page\s*\d+\s*of\s*\d+/g, '')).join('')
    expect(text.replace(/\s/g, '')).toContain(title)
    expect(pages.at(-1)?.text).toContain('Final item')
  }, 15_000)
  it('does not wrap inside a Devanagari grapheme or conjunct', async () => {
    const titles = ['aa' + 'हिन्दी'.repeat(25), 'aa' + 'कृष्ण'.repeat(35)]
    const item = (title: string) => ({ title, kind: 'Classwork' as const, categoryName: null, earned: 8, possible: 10, percent: 80, included: true, isZeroWeight: false })
    const files = unzipSync(await buildGradebookReportArchive('Course', [{ studentName: 'Student', currentPercent: 80, items: titles.map(item) }]))
    const text = extractText(Object.values(files)[0]).map((page) => page.text).join('\n')
    for (const title of titles) expect(text.replace(/\s/g, '')).toContain(title)
    for (const line of text.split('\n')) expect(line).not.toMatch(/^\p{Mark}/u)
  })
  it('fails safely when mixed right-to-left text would wrap', async () => {
    const title = 'محمد '.repeat(18) + 'Math 101 (محمد) 2026'
    const item = { title, kind: 'Classwork' as const, categoryName: null, earned: 8, possible: 10, percent: 80, included: true, isZeroWeight: false }
    await expect(buildGradebookReportArchive('Course', [{ studentName: 'Student', currentPercent: 80, items: [item] }])).rejects.toThrow('right-to-left name or title is too long')
  })
  it('explains which marks appear and labels an unavailable grade', async () => {
    const files = unzipSync(await buildGradebookReportArchive('Course', [{ studentName: 'Student', currentPercent: null, items: [] }]))
    const text = extractText(Object.values(files)[0]).map((page) => page.text).join('\n')
    expect(text).toContain('Not available')
    expect(text).toContain('Only returned classwork and tests, and saved Gradebook marks, appear here.')
    expect(text).toContain('No marks are available to show yet.')
  })
  it('explains when an assessment does not count toward the current grade', async () => {
    const item = { title: 'Practice', kind: 'Classwork' as const, categoryName: null, earned: 8, possible: 10, percent: 80, included: false, isZeroWeight: true }
    const files = unzipSync(await buildGradebookReportArchive('Course', [{ studentName: 'Student', currentPercent: null, items: [item] }]))
    const text = extractText(Object.values(files)[0]).map((page) => page.text).join('\n')
    expect(text).toContain('Does not count toward current grade')
  })
  it('exports an excluded assessment with a mixed right-to-left category', async () => {
    const item = { title: 'Assessment', kind: 'Classwork' as const, categoryName: 'Knowledge and Understanding / ידע והבנה', earned: 18, possible: 20, percent: 90, included: false, isZeroWeight: false }
    const files = unzipSync(await buildGradebookReportArchive('Course', [{ studentName: 'Student', currentPercent: null, items: [item] }]))
    const text = extractText(Object.values(files)[0]).map((page) => page.text).join('\n')
    expect(text).toContain(item.categoryName)
    expect(text).toContain('Does not count toward current grade')
  })
  it('wraps ordinary assessment titles at word boundaries when possible', async () => {
    const item = { title: 'reading '.repeat(30).trim(), kind: 'Classwork' as const, categoryName: null, earned: 8, possible: 10, percent: 80, included: true, isZeroWeight: false }
    const files = unzipSync(await buildGradebookReportArchive('Course', [{ studentName: 'Student', currentPercent: 80, items: [item] }]))
    const lines = extractText(Object.values(files)[0]).flatMap((page) => page.text.split('\n')).filter((line) => line.startsWith('reading'))
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) expect(line.trim()).toMatch(/^(reading\s*)+(?:80\.0%)?$/)
  })
  it('keeps a space and its combining mark together across wrapping', async () => {
    const item = { title: `Start \u0301${'W'.repeat(100)}`, kind: 'Classwork' as const, categoryName: null, earned: 8, possible: 10, percent: 80, included: true, isZeroWeight: false }
    const files = unzipSync(await buildGradebookReportArchive('Course', [{ studentName: 'Student', currentPercent: 80, items: [item] }]))
    const text = extractText(Object.values(files)[0]).map((page) => page.text).join('\n')
    expect(text).toContain('Start \u0301')
    expect(text).not.toMatch(/\n\p{Mark}/u)
  })
  it('keeps each assessment title and score on the same page when they fit', async () => {
    const items = Array.from({ length: 18 }, (_, i) => ({ title: `Item ${i + 1}`, kind: 'Classwork' as const, categoryName: 'Term Work', earned: 18, possible: 20, percent: 90, included: true, isZeroWeight: false }))
    const files = unzipSync(await buildGradebookReportArchive('Course', [{ studentName: 'Student', currentPercent: 90, items }]))
    const pages = extractText(Object.values(files)[0])
    expect(pages.length).toBeGreaterThan(1)
    for (const page of pages) {
      expect((page.text.match(/Item \d+/g) ?? []).length).toBe((page.text.match(/18 \/ 20 points/g) ?? []).length)
    }
  })
})
