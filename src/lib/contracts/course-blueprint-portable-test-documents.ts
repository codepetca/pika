import { z } from 'zod'
import { MAX_TEST_DOCUMENTS, MAX_TEST_DOCUMENT_TEXT_LENGTH } from '@/lib/test-documents'

const portableDocumentBaseShape = {
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(120),
}

export const portableCoursePackageLinkDocumentSchema = z.object({
  ...portableDocumentBaseShape,
  source: z.literal('link'),
  url: z.string().url().refine((value) => {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:'
  }, 'Link document URL must use HTTP or HTTPS'),
}).strict()

export const portableCoursePackageTextDocumentSchema = z.object({
  ...portableDocumentBaseShape,
  source: z.literal('text'),
  content: z.string().trim().min(1).max(MAX_TEST_DOCUMENT_TEXT_LENGTH),
}).strict()

export const portableCoursePackageTestDocumentSchema = z.discriminatedUnion('source', [
  portableCoursePackageLinkDocumentSchema,
  portableCoursePackageTextDocumentSchema,
])

export const portableCoursePackageTestDocumentsSchema = z
  .array(portableCoursePackageTestDocumentSchema)
  .max(MAX_TEST_DOCUMENTS)

export type PortableCoursePackageTestDocument = z.infer<
  typeof portableCoursePackageTestDocumentSchema
>
