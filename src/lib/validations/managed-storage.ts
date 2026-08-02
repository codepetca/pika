import { z } from 'zod'

export const assignmentInlineImageUploadMetadataSchema = z.object({
  assignment_doc_id: z.string().uuid(),
}).strict()

export const testDocumentUploadMetadataSchema = z.object({
  document_id: z.string().uuid(),
}).strict()
