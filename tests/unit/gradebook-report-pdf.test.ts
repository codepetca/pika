import { readFileSync } from 'node:fs'
import { unzipSync } from 'fflate'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { buildGradebookReportArchive } from '@/lib/gradebook-report-pdf'

describe('gradebook report archive', () => {
  const font = readFileSync('public/fonts/gradebook-report/NotoSans.ttf')
  it('creates one independent PDF per student, including duplicate names', async () => {
    const report = { studentName: 'Élodie Smith', currentPercent: 80, items: [] }
    const files = unzipSync(await buildGradebookReportArchive('Course', [report, report], font))
    expect(Object.keys(files)).toHaveLength(2)
    for (const bytes of Object.values(files)) expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1)
  })
  it('fails rather than silently replacing unsupported characters', async () => {
    await expect(buildGradebookReportArchive('Course', [{ studentName: '學生', currentPercent: null, items: [] }], font)).rejects.toThrow('cannot display')
  })
  it('does not create a blank page for trailing spacing', async () => {
    const item = { title: 'Short item', kind: 'Classwork' as const, categoryName: null, earned: 8, possible: 10, percent: 80, included: true, isZeroWeight: false }
    const files = unzipSync(await buildGradebookReportArchive('Course', [{ studentName: 'Student', currentPercent: 80, items: Array(12).fill(item) }], font))
    expect((await PDFDocument.load(Object.values(files)[0])).getPageCount()).toBe(1)
  })
})
