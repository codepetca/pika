import {z} from 'zod'
import {courseBlueprintAuthoringGuidanceSchema} from '@/lib/course-blueprint-authoring-guidance'
import type {CourseBlueprintSnapshotSource} from '@/lib/server/course-blueprint-versions'

export const CLASSROOM_GUIDANCE_ADOPTION_WIRE_BYTES=8*1024*1024
const uuid=z.string().uuid().transform(s=>s.toLowerCase())
const artifact=z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
const positive=z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),count=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const int32=z.number().int().min(-2147483648).max(2147483647),weight=int32.min(0).max(999),percent=int32.min(0).max(100)
const text=z.string().max(CLASSROOM_GUIDANCE_ADOPTION_WIRE_BYTES)
const json=z.json().superRefine((value,ctx)=>{if(Buffer.byteLength(JSON.stringify(value),'utf8')>CLASSROOM_GUIDANCE_ADOPTION_WIRE_BYTES)ctx.addIssue({code:'custom',message:'Persisted JSON exceeds private work bound'})})
const points=z.number().min(-9999.99).max(9999.99).refine(n=>Number(n.toFixed(2))===n).nullable()
const sha=z.string().regex(/^[a-f0-9]{64}$/)
export const contextualClassroomGuidanceAdoptionParamsSchema=z.object({id:uuid}).strict()
export const contextualClassroomGuidanceAdoptionInputSchema=z.object({blueprint_id:uuid,expected_content_version_id:uuid,expected_guidance_version_id:uuid,expected_draft_revision:positive}).strict()
export const contextualClassroomGuidanceAdoptionQuerySchema=contextualClassroomGuidanceAdoptionInputSchema.extend({actorId:uuid,classroomId:uuid}).strict()
// Validate the persisted domain, but discard the validator's normalized output.
// The unchanged canonical builder alone owns edge trimming/defaults/stripping.
const guidance=json.superRefine((value,ctx)=>{if(value!==null&&!courseBlueprintAuthoringGuidanceSchema.safeParse(value).success)ctx.addIssue({code:'custom',message:'Invalid persisted authoring guidance'})})
const requirement=z.object({id:artifact.optional(),type:z.enum(['repo_link','link','image']),label:text.nullable().optional(),instructions:text.nullable().optional(),required:z.boolean().nullable().optional(),position:int32.nullable().optional(),validation_policy_json:z.record(z.string(),json).nullable().optional()}).passthrough()
const question=z.object({id:artifact,question_type:z.enum(['multiple_choice','open_response']),question_text:text,options:z.array(text),correct_option:int32.nullable(),answer_key:text.max(20000).nullable(),sample_solution:text.max(20000).nullable(),points:z.number().positive().max(Number.MAX_SAFE_INTEGER),response_max_chars:int32.min(1).max(20000),response_monospace:z.boolean()}).passthrough().superRefine((q,ctx)=>{if(q.question_type==='multiple_choice'&&(q.options.length<2||q.correct_option===null||q.correct_option<0||q.correct_option>=q.options.length))ctx.addIssue({code:'custom',message:'Invalid persisted multiple-choice options'})})
const content=z.intersection(json,z.object({title:text.nullable().optional(),show_results:z.boolean().nullable().optional(),questions:z.array(question).nullable().optional(),question_identity_version:z.literal(1).optional(),source_format:z.literal('markdown').optional(),source_markdown:text.nullable().optional()}).passthrough())
const child={id:uuid,course_blueprint_id:uuid,artifact_id:artifact,title:text,position:int32}
const assignment=z.object({...child,instructions_markdown:text,submission_requirements_json:z.intersection(json,z.array(requirement)),default_due_days:int32,default_due_time:text,points_possible:points,gradebook_weight:weight,include_in_final:z.boolean(),is_draft:z.boolean(),track_authenticity:z.boolean()}).strict()
const assessment=z.object({...child,assessment_type:z.literal('test'),content,documents:json,points_possible:points,gradebook_weight:weight,include_in_final:z.boolean()}).strict()
const lesson=z.object({...child,content_markdown:text}).strict()
const surveyQuestion=z.object({id:artifact,question_type:z.enum(['multiple_choice','short_text','link']),question_text:text,options:z.array(text),response_max_chars:int32.min(1).max(5000),position:int32}).passthrough().superRefine((q,ctx)=>{if(q.question_type==='multiple_choice'?q.options.length<2:q.options.length!==0)ctx.addIssue({code:'custom',message:'Invalid persisted survey options'})})
const survey=z.object({...child,show_results:z.boolean(),dynamic_responses:z.boolean(),questions_json:z.intersection(json,z.array(surveyQuestion))}).strict()
const blueprint=z.object({id:uuid,teacher_id:uuid,content_revision:positive,title:text,subject:text,grade_level:text,course_code:text,term_template:text,overview_markdown:text,outline_markdown:text,resources_markdown:text,authoring_guidance:guidance,gradebook_use_weights:z.boolean(),gradebook_assignments_weight:percent,gradebook_tests_weight:percent,planned_site_slug:text.nullable(),planned_site_published:z.boolean(),planned_site_config:json}).strict().superRefine((b,ctx)=>{if(b.gradebook_use_weights&&b.gradebook_assignments_weight+b.gradebook_tests_weight!==100)ctx.addIssue({code:'custom',message:'Invalid persisted gradebook total'})})
const version=z.object({id:uuid,course_blueprint_id:uuid}).strict()
const sourceData=z.object({actor_id:uuid,classroom_id:uuid,classroom:z.object({id:uuid,teacher_id:uuid,archived_at:z.null(),source_blueprint_id:uuid,source_blueprint_version_id:uuid,authoring_guidance_version_id:uuid.nullable()}).strict(),versions:z.object({content:version,guidance:version.extend({version_number:positive}).strict()}).strict(),
  source:z.object({blueprint,assignments:z.array(assignment),assessments:z.array(assessment),lesson_templates:z.array(lesson),materials:z.array(lesson),surveys:z.array(survey)}).strict(),counts:z.object({assignments:count,assessments:count,lesson_templates:count,materials:count,surveys:count}).strict(),source_sha256:sha}).strict().superRefine((r,ctx)=>{
  const b=r.source.blueprint,c=r.classroom,v=r.versions
  if(r.actor_id!==c.teacher_id||r.actor_id!==b.teacher_id||r.classroom_id!==c.id||b.id!==c.source_blueprint_id||v.content.id!==c.source_blueprint_version_id||v.content.course_blueprint_id!==b.id||v.guidance.id!==(c.authoring_guidance_version_id??c.source_blueprint_version_id)||v.guidance.course_blueprint_id!==b.id)ctx.addIssue({code:'custom',message:'Adoption source identity mismatch'})
  const artifacts=new Set<string>(),register=(id:string|undefined)=>{if(!id||artifacts.has(id.toLowerCase()))ctx.addIssue({code:'custom',message:'Missing or duplicate canonical Artifact ID'});else artifacts.add(id.toLowerCase())}
  for(const key of['assignments','assessments','lesson_templates','materials','surveys']as const){const rows=r.source[key];if(r.counts[key]!==rows.length)ctx.addIssue({code:'custom',message:'Adoption source count mismatch'});const rowsSeen=new Set<string>();for(const row of rows){if(row.course_blueprint_id!==b.id||rowsSeen.has(row.id))ctx.addIssue({code:'custom',message:'Adoption child parent or duplicate identity mismatch'});rowsSeen.add(row.id);register(row.artifact_id)}}
  for(const a of r.source.assignments)for(const req of a.submission_requirements_json)register(req.id)
  for(const a of r.source.assessments)for(const q of a.content.questions??[])register(q.id)
  for(const s of r.source.surveys)for(const q of s.questions_json)register(q.id)
})
const envelope={error:z.null(),status:z.number().int().min(200).max(299),statusText:z.string(),count:z.union([z.null(),z.literal(1)])}
export const contextualClassroomGuidanceAdoptionSourceSuccessSchema=z.object({data:sourceData,...envelope}).strict()
export const contextualClassroomGuidanceAdoptionWriteSuccessSchema=z.object({data:z.object({actor_id:uuid,classroom_id:uuid,blueprint_id:uuid,content_version_id:uuid,previous_guidance_version_id:uuid,source_sha256:sha,guidance_version:z.object({id:uuid,course_blueprint_id:uuid,version_number:positive,source_draft_revision:positive,snapshot_sha256:sha}).strict()}).strict().superRefine((r,ctx)=>{if(r.guidance_version.course_blueprint_id!==r.blueprint_id)ctx.addIssue({code:'custom',message:'Adoption result parent mismatch'})}),...envelope}).strict()
export const contextualClassroomGuidanceAdoptionFailureSchema=z.object({data:z.null(),error:z.object({code:z.string(),message:z.string(),details:z.string().nullable(),hint:z.string().nullable()}).strict(),status:z.number().int().min(400).max(599),statusText:z.string(),count:z.null()}).strict()

export function sourceToSnapshotInput(row:z.infer<typeof sourceData>):CourseBlueprintSnapshotSource {
  const {blueprint:b,assignments,assessments,lesson_templates,materials,surveys}=row.source
  return{id:b.id,content_revision:b.content_revision,title:b.title,subject:b.subject,grade_level:b.grade_level,course_code:b.course_code,term_template:b.term_template,overview_markdown:b.overview_markdown,outline_markdown:b.outline_markdown,resources_markdown:b.resources_markdown,authoring_guidance:b.authoring_guidance,gradebook_use_weights:b.gradebook_use_weights,gradebook_assignments_weight:b.gradebook_assignments_weight,gradebook_tests_weight:b.gradebook_tests_weight,planned_site_slug:b.planned_site_slug,planned_site_published:b.planned_site_published,planned_site_config:b.planned_site_config,
    assignments:assignments.map(({artifact_id,title,instructions_markdown,submission_requirements_json,default_due_days,default_due_time,points_possible,gradebook_weight,include_in_final,is_draft,track_authenticity,position})=>({artifact_id,title,instructions_markdown,submission_requirements_json,default_due_days,default_due_time,points_possible,gradebook_weight,include_in_final,is_draft,track_authenticity,position})),
    assessments:assessments.map(({artifact_id,assessment_type,title,content,documents,points_possible,gradebook_weight,include_in_final,position})=>({artifact_id,assessment_type,title,content,documents,points_possible,gradebook_weight,include_in_final,position})),
    lesson_templates:lesson_templates.map(({artifact_id,title,content_markdown,position})=>({artifact_id,title,content_markdown,position})),materials:materials.map(({artifact_id,title,content_markdown,position})=>({artifact_id,title,content_markdown,position})),surveys:surveys.map(({artifact_id,title,show_results,dynamic_responses,questions_json,position})=>({artifact_id,title,show_results,dynamic_responses,questions_json,position}))}
}
