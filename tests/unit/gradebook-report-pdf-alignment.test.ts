import { unzipSync } from 'fflate'
import { extractText } from 'pdfnative'
import { expect, it, vi } from 'vitest'
import { buildGradebookReportArchive } from '@/lib/gradebook-report-pdf'

it('places the percentage beside the title and raw mark beside the category', async () => {
  const item = { title: 'Personal Narrative Essay', kind: 'Classwork' as const, categoryName: 'Term', earned: 25, possible: 30, percent: 83.3, included: true, isZeroWeight: false }
  const files = unzipSync(await buildGradebookReportArchive('Course', [{ studentName: 'Student', currentPercent: 83.3, items: [item] }]))
  const lines = extractText(Object.values(files)[0])[0].text.split('\n')
  expect(lines.find((line) => line.includes('Gradebook report'))).toMatch(/Gradebook report\s+CURRENT GRADE/)
  expect(lines.find((line) => line.includes('Student'))).toMatch(/Student\s+83\.3%/)
  expect(lines.join('\n')).not.toContain('STUDENT GRADEBOOK REPORT')
  expect(lines.find((line) => line.includes(item.title))).toMatch(/Personal Narrative Essay\s+83\.3%/)
  expect(lines.find((line) => line.includes('Classwork'))).toMatch(/Classwork\s*·\s*Term\s+25 \/ 30/)
  expect(lines.join('\n')).not.toContain('points')
})

it('dates every report using the Toronto calendar date', async () => {
  vi.useFakeTimers()
  try {
    vi.setSystemTime(new Date('2026-11-07T02:00:00Z'))
    const reports = ['First', 'Second'].map((studentName) => ({ studentName, currentPercent: null, items: [] }))
    const files = unzipSync(await buildGradebookReportArchive('Course', reports))
    for (const pdf of Object.values(files)) {
      expect(extractText(pdf)[0].text).toContain('Course · November 6, 2026')
    }
  } finally {
    vi.useRealTimers()
  }
})

it('fits 15 typical assessments on one page', async () => {
  const items = Array.from({ length: 15 }, (_, i) => ({ title: `Assessment ${i + 1}`, kind: 'Classwork' as const, categoryName: 'Term', earned: 18, possible: 20, percent: 90, included: true, isZeroWeight: false }))
  const files = unzipSync(await buildGradebookReportArchive('Course', [{ studentName: 'Student', currentPercent: 90, items }]))
  const pages = extractText(Object.values(files)[0])
  expect(pages).toHaveLength(1)
  for (const item of items) expect(pages[0].text).toContain(item.title)
})
