import { buildDocumentPDFBytes, loadFontData, registerFont, type DocumentBlock, type FontData, type FontEntry } from 'pdfnative'
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

/** Produce an archive of independent PDFs, never combining students in a report. */
export async function buildGradebookReportArchive(classroom: string, reports: GradebookStudentReport[], recipients?: GuardianRecipient[]): Promise<Uint8Array> {
  if (recipients && recipients.length !== reports.length) throw new Error('Could not match reports to guardian addresses. No reports were downloaded.')
  const files: Record<string, Uint8Array> = {}
  const manifest: string[][] = [['PDF file', 'Student', 'Guardian email in Pika', 'Status']]
  for (const [index, report] of reports.entries()) {
    if (!report.studentName) throw new Error('A student is missing a name. Add their name before exporting.')
    const lines = [classroom, `Student: ${report.studentName}`, 'Gradebook report',
      `Current grade: ${report.currentPercent == null ? 'Not available' : `${report.currentPercent.toFixed(1)}%`}`,
      'Based on returned work and saved Gradebook marks. This is not an official report card.',
      ...(report.items.length ? report.items.flatMap((item) => [item.title,
        `${item.kind}${item.categoryName ? ` · ${item.categoryName}` : ''}   ${item.earned} / ${item.possible}   (${item.percent.toFixed(1)}%)${item.isZeroWeight ? ' · 0 weight' : item.included ? '' : ' · Not counted'}`]) : ['No returned marks available.'])]
    const fontEntries = await reportFonts(lines.join('\n'))
    const blocks: DocumentBlock[] = lines.map((line, i) => ({ type: 'paragraph', text: line, fontSize: i === 2 ? 17 : 11, align: 'left' }))
    const pdf = buildDocumentPDFBytes({ blocks, fontEntries }, { tagged: true, direction: 'auto' })
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
