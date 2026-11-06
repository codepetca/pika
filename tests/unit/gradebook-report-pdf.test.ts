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
  it('does not create a blank page for trailing spacing', async () => {
    const item = { title: 'Short item', kind: 'Classwork' as const, categoryName: null, earned: 8, possible: 10, percent: 80, included: true, isZeroWeight: false }
    const files = unzipSync(await buildGradebookReportArchive('Course', [{ studentName: 'Student', currentPercent: 80, items: Array(12).fill(item) }]))
    expect((await PDFDocument.load(Object.values(files)[0])).getPageCount()).toBe(1)
  })
  it('keeps long multilingual titles and later marks across pages', async () => {
    const title = '中文測驗'.repeat(600)
    const item = { title, kind: 'Classwork' as const, categoryName: null, earned: 8, possible: 10, percent: 80, included: true, isZeroWeight: false }
    const files = unzipSync(await buildGradebookReportArchive('Course', [{ studentName: 'Student', currentPercent: 80, items: [item, { ...item, title: 'Final item' }] }]))
    const pages = extractText(Object.values(files)[0])
    expect(pages.length).toBeGreaterThan(1)
    expect(pages.map((page) => page.text).join('').replace(/\s/g, '').replace(/\d+\/\d+/g, '')).toContain(title)
    expect(pages.at(-1)?.text).toContain('Final item')
  })
})
