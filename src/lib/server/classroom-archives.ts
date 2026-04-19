import { decodeClassroomArchivePackage, encodeClassroomArchivePackage } from '@/lib/classroom-archive-package'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherOwnsClassroom, hydrateClassroomRecord } from '@/lib/server/classrooms'
import type { ClassroomArchiveManifest } from '@/types'

type SupabaseClient = ReturnType<typeof getServiceRoleClient>

type ClassroomArchiveSnapshot = {
  classroom: Record<string, any>
  class_days: Record<string, any>[]
  entries: Record<string, any>[]
  lesson_plans: Record<string, any>[]
  classroom_resources: Record<string, any> | null
  classroom_enrollments: Record<string, any>[]
  assignments: Record<string, any>[]
  assignment_docs: Record<string, any>[]
  assignment_doc_history: Record<string, any>[]
  assignment_feedback_entries: Record<string, any>[]
  quizzes: Record<string, any>[]
  quiz_questions: Record<string, any>[]
  quiz_responses: Record<string, any>[]
  tests: Record<string, any>[]
  test_questions: Record<string, any>[]
  test_attempts: Record<string, any>[]
  test_attempt_history: Record<string, any>[]
  test_responses: Record<string, any>[]
  assessment_drafts: Record<string, any>[]
  announcements: Record<string, any>[]
  announcement_reads: Record<string, any>[]
  gradebook_settings: Record<string, any> | null
}

function getSupabase() {
  return getServiceRoleClient()
}

function generateClassCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 6 }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('')
}

async function loadTableByIds(
  supabase: SupabaseClient,
  table: string,
  column: string,
  ids: string[]
) {
  if (ids.length === 0) return []
  const { data, error } = await supabase.from(table).select('*').in(column, ids)
  if (error) throw new Error(`Failed to load ${table}`)
  return (data || []) as Record<string, any>[]
}

export async function exportClassroomArchive(teacherId: string, classroomId: string) {
  const ownership = await assertTeacherOwnsClassroom(teacherId, classroomId)
  if (!ownership.ok) return ownership

  const supabase = getSupabase()
  const [
    classroomResult,
    classDaysResult,
    entriesResult,
    lessonPlansResult,
    resourcesResult,
    enrollmentsResult,
    assignmentsResult,
    quizzesResult,
    testsResult,
    announcementsResult,
    gradebookResult,
  ] = await Promise.all([
    supabase.from('classrooms').select('*').eq('id', classroomId).single(),
    supabase.from('class_days').select('*').eq('classroom_id', classroomId).order('date', { ascending: true }),
    supabase.from('entries').select('*').eq('classroom_id', classroomId).order('date', { ascending: true }),
    supabase.from('lesson_plans').select('*').eq('classroom_id', classroomId).order('date', { ascending: true }),
    supabase.from('classroom_resources').select('*').eq('classroom_id', classroomId).maybeSingle(),
    supabase.from('classroom_enrollments').select('*').eq('classroom_id', classroomId),
    supabase.from('assignments').select('*').eq('classroom_id', classroomId).order('position', { ascending: true }),
    supabase.from('quizzes').select('*').eq('classroom_id', classroomId).order('position', { ascending: true }),
    supabase.from('tests').select('*').eq('classroom_id', classroomId).order('position', { ascending: true }),
    supabase.from('announcements').select('*').eq('classroom_id', classroomId).order('created_at', { ascending: true }),
    supabase.from('gradebook_settings').select('*').eq('classroom_id', classroomId).maybeSingle(),
  ])

  if (
    classroomResult.error ||
    classDaysResult.error ||
    entriesResult.error ||
    lessonPlansResult.error ||
    resourcesResult.error ||
    enrollmentsResult.error ||
    assignmentsResult.error ||
    quizzesResult.error ||
    testsResult.error ||
    announcementsResult.error ||
    gradebookResult.error
  ) {
    console.error(
      'Error exporting classroom archive:',
      classroomResult.error ||
        classDaysResult.error ||
        entriesResult.error ||
        lessonPlansResult.error ||
        resourcesResult.error ||
        enrollmentsResult.error ||
        assignmentsResult.error ||
        quizzesResult.error ||
        testsResult.error ||
        announcementsResult.error ||
        gradebookResult.error
    )
    return { ok: false as const, status: 500, error: 'Failed to export classroom archive' }
  }

  const assignments = (assignmentsResult.data || []) as Record<string, any>[]
  const assignmentIds = assignments.map((assignment) => assignment.id as string)
  const quizzes = (quizzesResult.data || []) as Record<string, any>[]
  const quizIds = quizzes.map((quiz) => quiz.id as string)
  const tests = (testsResult.data || []) as Record<string, any>[]
  const testIds = tests.map((test) => test.id as string)
  const announcements = (announcementsResult.data || []) as Record<string, any>[]
  const announcementIds = announcements.map((announcement) => announcement.id as string)

  const [
    assignmentDocs,
    quizQuestions,
    quizResponses,
    testQuestions,
    testAttempts,
    testResponses,
    assessmentDrafts,
    announcementReads,
  ] = await Promise.all([
    loadTableByIds(supabase, 'assignment_docs', 'assignment_id', assignmentIds),
    loadTableByIds(supabase, 'quiz_questions', 'quiz_id', quizIds),
    loadTableByIds(supabase, 'quiz_responses', 'quiz_id', quizIds),
    loadTableByIds(supabase, 'test_questions', 'test_id', testIds),
    loadTableByIds(supabase, 'test_attempts', 'test_id', testIds),
    loadTableByIds(supabase, 'test_responses', 'test_id', testIds),
    loadTableByIds(supabase, 'assessment_drafts', 'classroom_id', [classroomId]),
    loadTableByIds(supabase, 'announcement_reads', 'announcement_id', announcementIds),
  ])

  const assignmentDocIds = assignmentDocs.map((doc) => doc.id as string)
  const testAttemptIds = testAttempts.map((attempt) => attempt.id as string)

  const [assignmentDocHistory, assignmentFeedbackEntries, testAttemptHistory] = await Promise.all([
    loadTableByIds(supabase, 'assignment_doc_history', 'assignment_doc_id', assignmentDocIds),
    loadTableByIds(supabase, 'assignment_feedback_entries', 'assignment_id', assignmentIds),
    loadTableByIds(supabase, 'test_attempt_history', 'test_attempt_id', testAttemptIds),
  ])

  const classroom = hydrateClassroomRecord(classroomResult.data as Record<string, any>)
  const manifest: ClassroomArchiveManifest = {
    version: '1',
    exported_at: new Date().toISOString(),
    classroom_title: classroom.title,
    class_code: classroom.class_code,
    term_label: classroom.term_label,
    teacher_id: classroom.teacher_id,
    source_blueprint_origin: classroom.source_blueprint_origin,
  }

  const snapshot: ClassroomArchiveSnapshot = {
    classroom: classroomResult.data as Record<string, any>,
    class_days: (classDaysResult.data || []) as Record<string, any>[],
    entries: (entriesResult.data || []) as Record<string, any>[],
    lesson_plans: (lessonPlansResult.data || []) as Record<string, any>[],
    classroom_resources: (resourcesResult.data || null) as Record<string, any> | null,
    classroom_enrollments: (enrollmentsResult.data || []) as Record<string, any>[],
    assignments,
    assignment_docs: assignmentDocs,
    assignment_doc_history: assignmentDocHistory,
    assignment_feedback_entries: assignmentFeedbackEntries,
    quizzes,
    quiz_questions: quizQuestions,
    quiz_responses: quizResponses,
    tests,
    test_questions: testQuestions,
    test_attempts: testAttempts,
    test_attempt_history: testAttemptHistory,
    test_responses: testResponses,
    assessment_drafts: assessmentDrafts,
    announcements,
    announcement_reads: announcementReads,
    gradebook_settings: (gradebookResult.data || null) as Record<string, any> | null,
  }

  const archive = encodeClassroomArchivePackage({ manifest, snapshot })
  return { ok: true as const, manifest, archive }
}

function remapId(map: Map<string, string>, value: string | null | undefined) {
  if (!value) return value ?? null
  return map.get(value) ?? value
}

export async function importClassroomArchive(teacherId: string, input: ArrayBuffer | Uint8Array) {
  const bundle = decodeClassroomArchivePackage(input)
  if (!bundle) {
    return { ok: false as const, status: 400, error: 'Invalid classroom archive package' }
  }

  const snapshot = bundle.snapshot as ClassroomArchiveSnapshot
  if (!snapshot?.classroom?.id) {
    return { ok: false as const, status: 400, error: 'Archive snapshot is missing classroom metadata' }
  }

  const supabase = getSupabase()
  const newClassroomId = crypto.randomUUID()
  const assignmentIdMap = new Map<string, string>()
  const assignmentDocIdMap = new Map<string, string>()
  const quizIdMap = new Map<string, string>()
  const quizQuestionIdMap = new Map<string, string>()
  const testIdMap = new Map<string, string>()
  const testQuestionIdMap = new Map<string, string>()
  const testAttemptIdMap = new Map<string, string>()
  const announcementIdMap = new Map<string, string>()

  const restoredTitle = `${snapshot.classroom.title} (Restored)`

  const { error: classroomError } = await supabase.from('classrooms').insert({
    ...snapshot.classroom,
    id: newClassroomId,
    teacher_id: teacherId,
    title: restoredTitle,
    class_code: generateClassCode(),
    allow_enrollment: false,
    actual_site_slug: null,
    actual_site_published: false,
    archived_at: new Date().toISOString(),
  })

  if (classroomError) {
    console.error('Error restoring classroom archive:', classroomError)
    return { ok: false as const, status: 500, error: 'Failed to restore classroom' }
  }

  const mapRows = <T extends Record<string, any>>(
    rows: T[],
    map: Map<string, string>,
    transform: (row: T, newId: string) => Record<string, any>
  ) =>
    rows.map((row) => {
      const newId = crypto.randomUUID()
      map.set(row.id as string, newId)
      return transform(row, newId)
    })

  const classDayRows = (snapshot.class_days || []).map((row) => ({
    ...row,
    id: crypto.randomUUID(),
    classroom_id: newClassroomId,
  }))
  if (classDayRows.length > 0) await supabase.from('class_days').insert(classDayRows)

  const entryRows = (snapshot.entries || []).map((row) => ({
    ...row,
    id: crypto.randomUUID(),
    classroom_id: newClassroomId,
  }))
  if (entryRows.length > 0) await supabase.from('entries').insert(entryRows)

  const lessonPlanRows = (snapshot.lesson_plans || []).map((row) => ({
    ...row,
    id: crypto.randomUUID(),
    classroom_id: newClassroomId,
  }))
  if (lessonPlanRows.length > 0) await supabase.from('lesson_plans').insert(lessonPlanRows)

  if (snapshot.classroom_resources) {
    await supabase.from('classroom_resources').insert({
      ...snapshot.classroom_resources,
      id: crypto.randomUUID(),
      classroom_id: newClassroomId,
    })
  }

  const enrollmentRows = (snapshot.classroom_enrollments || []).map((row) => ({
    ...row,
    id: crypto.randomUUID(),
    classroom_id: newClassroomId,
  }))
  if (enrollmentRows.length > 0) await supabase.from('classroom_enrollments').insert(enrollmentRows)

  const assignmentRows = mapRows(snapshot.assignments || [], assignmentIdMap, (row, newId) => ({
    ...row,
    id: newId,
    classroom_id: newClassroomId,
  }))
  if (assignmentRows.length > 0) await supabase.from('assignments').insert(assignmentRows)

  const assignmentDocRows = mapRows(snapshot.assignment_docs || [], assignmentDocIdMap, (row, newId) => ({
    ...row,
    id: newId,
    assignment_id: remapId(assignmentIdMap, row.assignment_id),
  }))
  if (assignmentDocRows.length > 0) await supabase.from('assignment_docs').insert(assignmentDocRows)

  const assignmentDocHistoryRows = (snapshot.assignment_doc_history || []).map((row) => ({
    ...row,
    id: crypto.randomUUID(),
    assignment_doc_id: remapId(assignmentDocIdMap, row.assignment_doc_id),
  }))
  if (assignmentDocHistoryRows.length > 0) await supabase.from('assignment_doc_history').insert(assignmentDocHistoryRows)

  const assignmentFeedbackRows = (snapshot.assignment_feedback_entries || []).map((row) => ({
    ...row,
    id: crypto.randomUUID(),
    assignment_id: remapId(assignmentIdMap, row.assignment_id),
  }))
  if (assignmentFeedbackRows.length > 0) await supabase.from('assignment_feedback_entries').insert(assignmentFeedbackRows)

  const quizRows = mapRows(snapshot.quizzes || [], quizIdMap, (row, newId) => ({
    ...row,
    id: newId,
    classroom_id: newClassroomId,
  }))
  if (quizRows.length > 0) await supabase.from('quizzes').insert(quizRows)

  const quizQuestionRows = mapRows(snapshot.quiz_questions || [], quizQuestionIdMap, (row, newId) => ({
    ...row,
    id: newId,
    quiz_id: remapId(quizIdMap, row.quiz_id),
  }))
  if (quizQuestionRows.length > 0) await supabase.from('quiz_questions').insert(quizQuestionRows)

  const quizResponseRows = (snapshot.quiz_responses || []).map((row) => ({
    ...row,
    id: crypto.randomUUID(),
    quiz_id: remapId(quizIdMap, row.quiz_id),
    question_id: remapId(quizQuestionIdMap, row.question_id),
  }))
  if (quizResponseRows.length > 0) await supabase.from('quiz_responses').insert(quizResponseRows)

  const testRows = mapRows(snapshot.tests || [], testIdMap, (row, newId) => ({
    ...row,
    id: newId,
    classroom_id: newClassroomId,
  }))
  if (testRows.length > 0) await supabase.from('tests').insert(testRows)

  const testQuestionRows = mapRows(snapshot.test_questions || [], testQuestionIdMap, (row, newId) => ({
    ...row,
    id: newId,
    test_id: remapId(testIdMap, row.test_id),
  }))
  if (testQuestionRows.length > 0) await supabase.from('test_questions').insert(testQuestionRows)

  const testAttemptRows = mapRows(snapshot.test_attempts || [], testAttemptIdMap, (row, newId) => ({
    ...row,
    id: newId,
    test_id: remapId(testIdMap, row.test_id),
  }))
  if (testAttemptRows.length > 0) await supabase.from('test_attempts').insert(testAttemptRows)

  const testAttemptHistoryRows = (snapshot.test_attempt_history || []).map((row) => ({
    ...row,
    id: crypto.randomUUID(),
    test_attempt_id: remapId(testAttemptIdMap, row.test_attempt_id),
  }))
  if (testAttemptHistoryRows.length > 0) await supabase.from('test_attempt_history').insert(testAttemptHistoryRows)

  const testResponseRows = (snapshot.test_responses || []).map((row) => ({
    ...row,
    id: crypto.randomUUID(),
    test_id: remapId(testIdMap, row.test_id),
    question_id: remapId(testQuestionIdMap, row.question_id),
  }))
  if (testResponseRows.length > 0) await supabase.from('test_responses').insert(testResponseRows)

  const assessmentDraftRows = (snapshot.assessment_drafts || []).map((row) => ({
    ...row,
    id: crypto.randomUUID(),
    classroom_id: newClassroomId,
    assessment_id:
      row.assessment_type === 'quiz'
        ? remapId(quizIdMap, row.assessment_id)
        : remapId(testIdMap, row.assessment_id),
  }))
  if (assessmentDraftRows.length > 0) await supabase.from('assessment_drafts').insert(assessmentDraftRows)

  const announcementRows = mapRows(snapshot.announcements || [], announcementIdMap, (row, newId) => ({
    ...row,
    id: newId,
    classroom_id: newClassroomId,
  }))
  if (announcementRows.length > 0) await supabase.from('announcements').insert(announcementRows)

  const announcementReadRows = (snapshot.announcement_reads || []).map((row) => ({
    ...row,
    id: crypto.randomUUID(),
    announcement_id: remapId(announcementIdMap, row.announcement_id),
  }))
  if (announcementReadRows.length > 0) await supabase.from('announcement_reads').insert(announcementReadRows)

  if (snapshot.gradebook_settings) {
    await supabase.from('gradebook_settings').upsert({
      ...snapshot.gradebook_settings,
      classroom_id: newClassroomId,
    })
  }

  const { data: classroom } = await supabase.from('classrooms').select('*').eq('id', newClassroomId).single()
  return { ok: true as const, classroom: classroom ? hydrateClassroomRecord(classroom as Record<string, any>) : null }
}
