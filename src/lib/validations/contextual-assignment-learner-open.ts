// Feature-owned HTTP input and fresh database-evidence schemas.
import { z } from 'zod'
import {
  boundedAssignmentListJson, contextualAssignmentListAssignmentSchema, contextualAssignmentListMemberDocSchema,
  contextualAssignmentListRequirementSchema, contextualAssignmentListReturnedGradeSchema, contextualAssignmentListReleasedFeedbackSchema,
} from '@/lib/validations/contextual-assignment-list-read'
import { contextualAssignmentOverviewArtifactSchema } from '@/lib/validations/contextual-assignment-overview-read'
import { contextualAssignmentStudentDetailFeedbackSchema } from '@/lib/validations/contextual-assignment-student-detail-read'

const uuid = z.string().uuid().refine(value => value === value.toLowerCase())
const timestamp = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)))
const json = z.unknown().refine(value => boundedAssignmentListJson(value, 2 * 1024 * 1024)).pipe(z.json())
export const assignmentLearnerOpenParamsSchema = z.object({ id: z.string().uuid().transform(value => value.toLowerCase()) }).strict()
export const assignmentLearnerOpenIdentitySchema = z.object({ actorId: z.string().uuid().transform(value => value.toLowerCase()),
  assignmentId: z.string().uuid().transform(value => value.toLowerCase()) }).strict()
export const learnerOpenMembershipSchema = z.object({ id: uuid, classroom_id: uuid, student_id: uuid }).strict()
export const learnerOpenControlSchema = z.object({ id: uuid, classroom_id: uuid, is_draft: z.boolean(), released_at: timestamp.nullable(), created_at: timestamp,
  classrooms: z.object({ id: uuid, teacher_id: uuid, archived_at: timestamp.nullable(),
    feature_visibility: z.unknown().refine(value => boundedAssignmentListJson(value, 4096)).pipe(z.json()),
  }).strict(),
}).strict()
export const learnerOpenRootSchema = learnerOpenControlSchema.extend({ classrooms: learnerOpenControlSchema.shape.classrooms.extend({
  membership: z.array(learnerOpenMembershipSchema).length(1),
}).strict() }).strict()
export const learnerOpenAssignmentSchema = contextualAssignmentListAssignmentSchema.extend({ classrooms: learnerOpenRootSchema.shape.classrooms }).strict()
export const learnerOpenDocSchema = contextualAssignmentListMemberDocSchema
export const learnerOpenGradeSchema = contextualAssignmentListReturnedGradeSchema.extend({ authenticity_score: z.number().finite().nullable(), authenticity_flags: json.nullable() }).strict()
export const learnerOpenFeedbackSchema = contextualAssignmentListReleasedFeedbackSchema
export const learnerOpenRequirementSchema = contextualAssignmentListRequirementSchema
export const learnerOpenArtifactSchema = contextualAssignmentOverviewArtifactSchema
export const learnerOpenFeedbackEntrySchema = contextualAssignmentStudentDetailFeedbackSchema
export const learnerOpenDocIdentitySchema = learnerOpenDocSchema.pick({ id: true, assignment_id: true, student_id: true }).strict()
export const learnerOpenGitHubSchema = z.object({ id: uuid, user_id: uuid, github_login: z.string().nullable(), commit_emails: z.array(z.string()).max(10000),
  validation_status: z.enum(['unvalidated', 'valid', 'invalid', 'inaccessible']), validation_message: z.string().nullable(), validated_at: timestamp.nullable(), created_at: timestamp, updated_at: timestamp,
}).strict()
