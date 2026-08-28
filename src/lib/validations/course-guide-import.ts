import { z } from 'zod'

export const COURSE_GUIDE_IMPORT_MAX_FILE_BYTES = 20 * 1024 * 1024

const blockedHostnames = new Set(['localhost', 'localhost.localdomain'])

function isPublicDocumentUrl(value: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return false
  }

  if (parsed.protocol !== 'https:') return false
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '')
  if (
    blockedHostnames.has(hostname)
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname.endsWith('.internal')
  ) return false

  // Public document links should use a hostname, not a literal private or
  // loopback address. OpenAI fetches URL inputs, so Pika never follows it.
  if (hostname.startsWith('[') || /^\d+(?:\.\d+){3}$/.test(hostname)) return false
  return true
}

export const courseGuideImportMetadataSchema = z.discriminatedUnion('sourceType', [
  z.object({
    sourceType: z.literal('file'),
    sourceUrl: z.literal(''),
  }).strict(),
  z.object({
    sourceType: z.literal('url'),
    sourceUrl: z.string()
      .trim()
      .min(1, 'Add a public document URL')
      .max(2048, 'The document URL is too long')
      .refine(isPublicDocumentUrl, 'Use a public HTTPS document URL'),
  }).strict(),
])

export const applyCourseGuideImportSchema = z.object({
  draftMarkdown: z.string()
    .trim()
    .min(1, 'The reviewed draft is empty')
    .max(60_000, 'The reviewed draft is too long'),
  expectedOverviewMarkdown: z.string().max(100_000),
  sourceTitle: z.string().trim().min(1).max(300),
  sourceUrl: z.string().trim().url().max(2048).refine(isPublicDocumentUrl).nullable(),
  sourceFilename: z.string().trim().min(1).max(255).nullable(),
}).strict().superRefine((value, context) => {
  if (!value.sourceUrl && !value.sourceFilename) {
    context.addIssue({
      code: 'custom',
      path: ['sourceFilename'],
      message: 'The curriculum source is required',
    })
  }
})

export const curriculumImportModelResponseSchema = z.object({
  document_title: z.string().trim().min(1).max(300),
  overview_markdown: z.string().trim().min(1).max(30_000),
  expectations_markdown: z.string().trim().max(30_000),
  source_links: z.array(z.object({
    title: z.string().trim().min(1).max(300),
    url: z.string().trim().url().max(2048),
  }).strict()).max(12),
}).strict()

export type ApplyCourseGuideImportInput = z.infer<typeof applyCourseGuideImportSchema>
export type CurriculumImportModelResponse = z.infer<typeof curriculumImportModelResponseSchema>
export type CourseGuideImportMetadata = z.infer<typeof courseGuideImportMetadataSchema>

export type CourseGuideImportSource =
  | { type: 'file'; filename: string; dataUrl: string }
  | { type: 'url'; url: string }

export async function decodeCourseGuideImportFormData(
  formData: FormData,
  metadata: CourseGuideImportMetadata,
): Promise<CourseGuideImportSource> {
  if (metadata.sourceType === 'url') {
    return { type: 'url', url: metadata.sourceUrl }
  }

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    throw new z.ZodError([{
      code: 'custom',
      path: ['file'],
      message: 'Choose a curriculum PDF',
    }])
  }
  if (file.size > COURSE_GUIDE_IMPORT_MAX_FILE_BYTES) {
    throw new z.ZodError([{
      code: 'custom',
      path: ['file'],
      message: 'The PDF must be 20 MB or smaller',
    }])
  }
  if (file.type !== 'application/pdf' || !file.name.toLowerCase().endsWith('.pdf')) {
    throw new z.ZodError([{
      code: 'custom',
      path: ['file'],
      message: 'Upload a PDF file',
    }])
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const header = [0x25, 0x50, 0x44, 0x46, 0x2d]
  const scanLimit = Math.min(bytes.length - header.length, 1019)
  const hasPdfHeader = Array.from({ length: Math.max(scanLimit + 1, 0) }).some((_, index) => (
    header.every((byte, offset) => bytes[index + offset] === byte)
  ))
  if (!hasPdfHeader) {
    throw new z.ZodError([{
      code: 'custom',
      path: ['file'],
      message: 'The selected file is not a valid PDF',
    }])
  }

  return {
    type: 'file',
    filename: file.name.slice(0, 255),
    dataUrl: `data:application/pdf;base64,${Buffer.from(bytes).toString('base64')}`,
  }
}
