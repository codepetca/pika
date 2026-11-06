import { unzipSync } from 'fflate'
import { extractText } from 'pdfnative'
import { expect, it } from 'vitest'
import { buildGradebookReportArchive } from '@/lib/gradebook-report-pdf'

it('places the percentage beside the title and points beside the category', async () => {
  const item = { title: 'Personal Narrative Essay', kind: 'Classwork' as const, categoryName: 'Term', earned: 25, possible: 30, percent: 83.3, included: true, isZeroWeight: false }
  const files = unzipSync(await buildGradebookReportArchive('Course', [{ studentName: 'Student', currentPercent: 83.3, items: [item] }]))
  const lines = extractText(Object.values(files)[0])[0].text.split('\n')
  expect(lines.find((line) => line.includes(item.title))).toMatch(/Personal Narrative Essay\s+83\.3%/)
  expect(lines.find((line) => line.includes('Classwork'))).toMatch(/Classwork\s*·\s*Term\s+25 \/ 30 points/)
})
