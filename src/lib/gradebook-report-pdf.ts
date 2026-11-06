import { buildDocumentPDFBytes, createEncodingContext, DEFAULT_CW, inspectDocumentLayout, loadFontData, registerFont, wrapText, type DocumentBlock, type FontData, type FontEntry, type PdfLayoutOptions } from 'pdfnative'
import { zipSync } from 'fflate'
import type { GradebookStudentReport } from './gradebook-report'
import type { GuardianRecipient } from './gradebook-email'

// Font data stays local to Pika. Load only the scripts needed for each report.
const fontLoaders = {
  latin: () => import('pdfnative/fonts/noto-sans-data.js'),
  ar: () => import('pdfnative/fonts/noto-arabic-data.js'),
  he: () => import('pdfnative/fonts/noto-hebrew-data.js'),
  hi: () => import('pdfnative/fonts/noto-devanagari-data.js'),
  bn: () => import('pdfnative/fonts/noto-bengali-data.js'),
  pa: () => import('pdfnative/fonts/noto-gurmukhi-data.js'),
  gu: () => import('pdfnative/fonts/noto-gujarati-data.js'),
  ta: () => import('pdfnative/fonts/noto-tamil-data.js'),
  te: () => import('pdfnative/fonts/noto-telugu-data.js'),
  kn: () => import('pdfnative/fonts/noto-kannada-data.js'),
  ml: () => import('pdfnative/fonts/noto-malayalam-data.js'),
  si: () => import('pdfnative/fonts/noto-sinhala-data.js'),
  th: () => import('pdfnative/fonts/noto-thai-data.js'),
  ru: () => import('pdfnative/fonts/noto-cyrillic-data.js'),
  el: () => import('pdfnative/fonts/noto-greek-data.js'),
  ja: () => import('pdfnative/fonts/noto-jp-data.js'),
  ko: () => import('pdfnative/fonts/noto-kr-data.js'),
  zh: () => import('pdfnative/fonts/noto-sc-data.js'),
} as const

type FontLanguage = keyof typeof fontLoaders
const scripts: Array<[FontLanguage, RegExp]> = [
  ['ar', /\p{Script=Arabic}/u], ['he', /\p{Script=Hebrew}/u], ['hi', /\p{Script=Devanagari}/u],
  ['bn', /\p{Script=Bengali}/u], ['pa', /\p{Script=Gurmukhi}/u], ['gu', /\p{Script=Gujarati}/u],
  ['ta', /\p{Script=Tamil}/u], ['te', /\p{Script=Telugu}/u], ['kn', /\p{Script=Kannada}/u],
  ['ml', /\p{Script=Malayalam}/u], ['si', /\p{Script=Sinhala}/u], ['th', /\p{Script=Thai}/u],
  ['ru', /\p{Script=Cyrillic}/u], ['el', /\p{Script=Greek}/u],
  ['ja', /[\p{Script=Hiragana}\p{Script=Katakana}]/u], ['ko', /\p{Script=Hangul}/u], ['zh', /\p{Script=Han}/u],
]
// The package's font module declarations are broader than its FontData type.
for (const [language, loader] of Object.entries(fontLoaders)) registerFont(language, async () => await loader() as unknown as FontData)

function safeFilename(value: string): string {
  return value.normalize('NFKC').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim().slice(0, 80) || 'Student'
}

async function reportFonts(text: string): Promise<FontEntry[]> {
  const languages: FontLanguage[] = ['latin', ...scripts.filter(([, pattern]) => pattern.test(text)).map(([language]) => language)]
  const loaded = await Promise.all(languages.map((language) => loadFontData(language)))
  if (loaded.some((font) => !font)) throw new Error('Could not load the report fonts. No reports were downloaded.')
  const fonts = loaded.filter((font): font is NonNullable<typeof font> => font != null)
  // Fail closed when a script or character is not covered; never substitute a name.
  if (Array.from(text).some((character) => !/[\s\p{Default_Ignorable_Code_Point}]/u.test(character)
    && !fonts.some((font) => Boolean(font.cmap[character.codePointAt(0)!])))) {
    throw new Error('A name or assessment contains characters the report fonts cannot display. No reports were downloaded.')
  }
  return fonts.map((fontData, index) => ({ fontData, fontRef: `/F${index + 3}`, lang: languages[index] }))
}

/** Keep the renderer from splitting combining marks or conjuncts across lines. */
function reportParagraphs(text: string, size: number, fonts: FontEntry[], options: { color?: string; keepWithNext?: boolean } = {}): DocumentBlock[] {
  if (typeof Intl.Segmenter !== 'function') throw new Error('This browser cannot safely wrap report text. No reports were downloaded.')
  const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  const encoding = createEncodingContext(fonts)
  const result: DocumentBlock[] = []
  const add = (line: string) => result.push({ type: 'paragraph', text: line, fontSize: size, align: 'left', ...options })
  for (const paragraph of text.split(/\r\n|\r|\n/)) {
    let line = ''
    const fits = (value: string) => encoding.tw(value, size) <= DEFAULT_CW && wrapText(value, DEFAULT_CW, size, encoding).length <= 1
    for (const { segment } of graphemes.segment(paragraph)) {
      const candidate = line + segment
      if (fits(candidate)) { line = candidate; continue }
      // Independent PDF blocks lose the original bidi context. Refuse a
      // wrapped RTL/mixed paragraph until it can retain that context safely.
      if (/[\p{Script=Arabic}\p{Script=Hebrew}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(paragraph)) {
        throw new Error('A right-to-left name or title is too long to display safely. Shorten it and try again. No reports were downloaded.')
      }
      if (!line || !fits(segment)) throw new Error('Report text cannot be wrapped safely. No reports were downloaded.')
      // Prefer a word boundary, while retaining grapheme-safe hard wrapping
      // for long words and scripts that do not use spaces.
      let boundary = -1
      for (const part of graphemes.segment(line)) if (part.segment === ' ') boundary = part.index
      const remainder = boundary > 0 ? line.slice(boundary + 1) + segment : ''
      if (boundary > 0 && fits(remainder)) {
        add(line.slice(0, boundary))
        line = remainder
      } else {
        add(line)
        line = segment
      }
    }
    if (line || !paragraph) add(line)
  }
  return result
}

/** Produce an archive of independent PDFs, never combining students in a report. */
export async function buildGradebookReportArchive(classroom: string, reports: GradebookStudentReport[], recipients?: GuardianRecipient[]): Promise<Uint8Array> {
  if (recipients && recipients.length !== reports.length) throw new Error('Could not match reports to guardian addresses. No reports were downloaded.')
  const files: Record<string, Uint8Array> = {}
  const manifest: string[][] = [['PDF file', 'Student', 'Guardian email in Pika', 'Status']]
  for (const [index, report] of reports.entries()) {
    if (!report.studentName) throw new Error('A student is missing a name. Add their name before exporting.')
    const itemLines = report.items.map((item) => ({
      title: item.title,
      category: `${item.kind}${item.categoryName ? ` · ${item.categoryName}` : ''}`,
      score: `${item.earned} / ${item.possible} points   |   ${item.percent.toFixed(1)}%`,
      status: item.included ? '' : 'Does not count toward current grade',
    }))
    const fontEntries = await reportFonts([classroom, report.studentName, ...itemLines.flatMap((item) => [item.title, item.category, item.score, item.status])].join('\n'))
    const blocks: DocumentBlock[] = []
    const layout: Partial<PdfLayoutOptions> = {
      pageWidth: 612, pageHeight: 792, tagged: true, direction: 'auto',
      footerTemplate: { left: 'Pika · Gradebook report', right: 'Page {page} of {pages}', fontSize: 8, color: '0.32 0.40 0.47' },
    }
    const add = (text: string, size: number, color: string, keepWithNext = false) => {
      blocks.push(...reportParagraphs(text, size, fontEntries, { color, keepWithNext }))
    }
    const space = (height: number) => blocks.push({ type: 'spacer', height })
    const ink = '0.09 0.17 0.23'
    const muted = '0.32 0.40 0.47'
    const accent = '0.09 0.42 0.41'
    add('STUDENT GRADEBOOK REPORT', 10, accent, true)
    space(5)
    add(report.studentName, 22, ink, true)
    add(classroom, 12, muted)
    space(13)
    add('CURRENT GRADE', 10, muted, true)
    add(report.currentPercent == null ? 'Not available' : `${report.currentPercent.toFixed(1)}%`, 25, accent)
    add('Based on returned work and saved Gradebook marks. This is not an official report card.', 10, muted)
    space(14)
    add('Assessment results', 15, ink, true)
    add('Only returned classwork and tests, and saved Gradebook marks, appear here.', 10, muted, true)
    space(6)
    if (itemLines.length === 0) add('No marks are available to show yet.', 11, muted)
    for (const item of itemLines) {
      const start = blocks.length
      add(item.title, 12, ink, true)
      add(item.category, 10, muted, true)
      add(`${item.score}${item.status ? `   |   ${item.status}` : ''}`, 10, muted)
      space(8)
      const group = blocks.slice(start)
      const all = inspectDocumentLayout({ blocks, fontEntries }, layout).pages.flatMap((page) => page.blocks)
      const placedBefore = blocks.slice(0, start).filter((block) => block.type !== 'pageBreak').length
      const firstPage = all[placedBefore]?.page
      const lastPage = all[placedBefore + group.length - 1]?.page
      if (firstPage != null && lastPage != null && firstPage !== lastPage
        && inspectDocumentLayout({ blocks: group, fontEntries }, layout).totalPages === 1) {
        blocks.splice(start, 0, { type: 'pageBreak' })
      }
    }
    const pdf = buildDocumentPDFBytes({ blocks, fontEntries }, layout)
    const filename = `${String(index + 1).padStart(3, '0')} - ${safeFilename(report.studentName)}.pdf`
    files[filename] = pdf
    if (recipients) manifest.push([filename, report.studentName, recipients[index].email, recipients[index].status])
  }
  if (recipients) {
    const csvCell = (value: string) => `"${(/^[\s]*[=+@-]/.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`
    files['guardian-recipients.csv'] = new TextEncoder().encode(`\uFEFF${manifest.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`)
  }
  return zipSync(files)
}
