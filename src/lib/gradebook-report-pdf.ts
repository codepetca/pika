import { PDFDocument, type PDFFont, type PDFPage } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { zipSync } from 'fflate'
import type { GradebookStudentReport } from './gradebook-report'

function safeFilename(value: string): string {
  return value.normalize('NFKC').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim().slice(0, 80) || 'Student'
}

/** Produce an archive of independent PDFs, never combining students in a report. */
export async function buildGradebookReportArchive(classroom: string, reports: GradebookStudentReport[], fontBytes: Uint8Array): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {}
  for (const [index, report] of reports.entries()) {
    if (!report.studentName) throw new Error('A student is missing a name. Add their name before exporting.')
    const doc = await PDFDocument.create()
    doc.registerFontkit(fontkit)
    const font = await doc.embedFont(fontBytes)
    const supported = new Set(font.getCharacterSet())
    const lines = [classroom, `Student: ${report.studentName}`, 'Gradebook report',
      `Current grade: ${report.currentPercent == null ? 'Not available' : `${report.currentPercent.toFixed(1)}%`}`,
      'Based on returned work and saved Gradebook marks. This is not an official report card.', '',
      ...(report.items.length ? report.items.flatMap((item) => [item.title,
        `${item.kind}${item.categoryName ? ` · ${item.categoryName}` : ''}   ${item.earned} / ${item.possible}   (${item.percent.toFixed(1)}%)${item.isZeroWeight ? ' · 0 weight' : item.included ? '' : ' · Not counted'}`, '']) : ['No returned marks available.'])]
    if (lines.some((line) => Array.from(line).some((char) => !supported.has(char.codePointAt(0)!)))) {
      throw new Error('A name or assessment contains characters the report font cannot display. No reports were downloaded.')
    }
    let page: PDFPage = doc.addPage([612, 792])
    let y = 744
    const writeLine = (line: string, size: number) => {
      if (!line) { y -= size + 6; return }
      if (y < 48) { page = doc.addPage([612, 792]); y = 744 }
      page.drawText(line, { x: 48, y, size, font })
      y -= size + 6
    }
    const wrap = (line: string, size: number, face: PDFFont): string[] => {
      if (!line) return ['']
      const result: string[] = []
      let part = ''
      for (const char of Array.from(line)) {
        if (part && face.widthOfTextAtSize(part + char, size) > 516) { result.push(part.trimEnd()); part = char.trimStart() }
        else part += char
      }
      if (part) result.push(part)
      return result
    }
    lines.forEach((line, i) => { const size = i === 2 ? 17 : 11; for (const part of wrap(line, size, font)) writeLine(part, size) })
    files[`${String(index + 1).padStart(3, '0')} - ${safeFilename(report.studentName)}.pdf`] = await doc.save()
  }
  return zipSync(files)
}
