import type { TiptapContent } from '../src/types'

type SupabaseLike = {
  from: (table: string) => {
    insert: (values: any) => any
    upsert: (values: any, options?: any) => any
    update: (values: any) => any
    eq: (column: string, value: any) => any
    select: (columns?: string) => any
    single: () => any
  }
}

type SeedStudent = {
  id: string
  email: string
}

type SeedAssignments = {
  narrative: { id: string }
  letter: { id: string }
}

function ensureOk(result: { error: any }, label: string) {
  if (result.error) {
    throw new Error(`${label} failed: ${result.error.message || JSON.stringify(result.error)}`)
  }
}

function ensureData<T>(data: T | null, label: string): T {
  if (!data) {
    throw new Error(`${label} returned no data`)
  }
  return data
}

function buildRepoEvidence(title: string, summary: string, authoredAt: string) {
  return [
    {
      id: `${title.toLowerCase().replace(/\s+/g, '-')}-commit`,
      type: 'commit',
      title,
      summary,
      authored_at: authoredAt,
    },
  ]
}

export async function seedAssignmentReviewFixtures(opts: {
  supabase: SupabaseLike
  classroomId: string
  teacherId: string
  students: SeedStudent[]
  assignments: SeedAssignments
  now: Date
}) {
  const { supabase, classroomId, teacherId, students, assignments, now } = opts
  const [student1, student2] = students
  if (!student1 || !student2) {
    throw new Error('seedAssignmentReviewFixtures requires two students')
  }

  const repoUrl = 'https://github.com/codepetca/pika'
  const altRepoUrl = 'https://github.com/vercel/next.js/tree/canary'
  const deployedUrl = 'https://example.com/class-project'
  const screenshotUrl = 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee'
  const nowIso = now.toISOString()
  const oneDayAgoIso = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const twoDaysAgoIso = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString()
  const threeDaysAgoIso = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString()
  const fourDaysAgoIso = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString()
  const fiveDaysAgoIso = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString()

  const letterStudent1Content: TiptapContent = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Working draft for the community letter.' },
        ],
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: `Primary repo: ${repoUrl}. Reference repo: ${altRepoUrl}. Preview: ${deployedUrl}. Screenshot: ${screenshotUrl}` },
        ],
      },
    ],
  }

  const letterStudent2Content: TiptapContent = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'I focused on the dashboard and testing notes for the shared project.' },
        ],
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: `Shared repo link: ${repoUrl}` },
        ],
      },
    ],
  }

  ensureOk(
    await supabase
      .from('assignment_docs')
      .update({
        score_completion: 8,
        score_thinking: 9,
        score_workflow: 8,
        feedback: 'Strong descriptive writing and clear structure. Keep tightening the ending so it lands a little more sharply.',
        teacher_feedback_draft: 'Strong descriptive writing and clear structure. Keep tightening the ending so it lands a little more sharply.',
        teacher_feedback_draft_updated_at: twoDaysAgoIso,
        feedback_returned_at: twoDaysAgoIso,
        graded_at: twoDaysAgoIso,
        graded_by: 'teacher',
        returned_at: twoDaysAgoIso,
        ai_feedback_suggestion: 'The writing is vivid and well organized. The ending could be more concise.',
        ai_feedback_suggested_at: threeDaysAgoIso,
        ai_feedback_model: 'seed-fixture',
      })
      .eq('assignment_id', assignments.narrative.id)
      .eq('student_id', student1.id),
    'Update returned narrative doc'
  )

  ensureOk(
    await supabase
      .from('assignment_docs')
      .update({
        score_completion: null,
        score_thinking: null,
        score_workflow: null,
        feedback: 'You found a clear moment to write about, but this still needs more detail and revision before it is ready to grade.',
        teacher_feedback_draft: 'You found a clear moment to write about, but this still needs more detail and revision before it is ready to return.',
        teacher_feedback_draft_updated_at: oneDayAgoIso,
        feedback_returned_at: oneDayAgoIso,
        ai_feedback_suggestion: 'Add more sensory detail and extend the reflection at the end.',
        ai_feedback_suggested_at: twoDaysAgoIso,
        ai_feedback_model: 'seed-fixture',
      })
      .eq('assignment_id', assignments.narrative.id)
      .eq('student_id', student2.id),
    'Update feedback-only narrative doc'
  )

  ensureOk(
    await supabase
      .from('assignment_docs')
      .upsert([
        {
          assignment_id: assignments.letter.id,
          student_id: student1.id,
          content: letterStudent1Content,
          repo_url: repoUrl,
          github_username: 'student1-demo',
          is_submitted: false,
          submitted_at: null,
          score_completion: 8,
          score_thinking: 8,
          score_workflow: 7,
          teacher_feedback_draft: 'The repo artifacts are in good shape. Before returning, I want a slightly clearer explanation of who owned the API integration work.',
          teacher_feedback_draft_updated_at: oneDayAgoIso,
          ai_feedback_suggestion: 'Student 1 appears to own the API and submission workflow; ask for a clearer written summary before final return.',
          ai_feedback_suggested_at: oneDayAgoIso,
          ai_feedback_model: 'repo-review-v2-seed',
        },
        {
          assignment_id: assignments.letter.id,
          student_id: student2.id,
          content: letterStudent2Content,
          repo_url: repoUrl,
          github_username: 'student2-demo',
          is_submitted: false,
          submitted_at: null,
          score_completion: 6,
          score_thinking: 7,
          score_workflow: 6,
          teacher_feedback_draft: 'Good shared-repo contribution, especially around tests and QA follow-up.',
          teacher_feedback_draft_updated_at: oneDayAgoIso,
          ai_feedback_suggestion: 'Student 2 contributed testing and review follow-up. Consider asking for a stronger written explanation of test strategy.',
          ai_feedback_suggested_at: oneDayAgoIso,
          ai_feedback_model: 'repo-review-v2-seed',
        },
      ], { onConflict: 'assignment_id,student_id' }),
    'Upsert letter docs with repo artifacts'
  )

  ensureOk(
    await supabase
      .from('assignment_feedback_entries')
      .insert([
        {
          assignment_id: assignments.narrative.id,
          student_id: student1.id,
          entry_kind: 'teacher_feedback',
          author_type: 'teacher',
          body: 'Your first draft had a strong voice. Revise the ending so it reflects more directly on what you learned.',
          returned_at: fourDaysAgoIso,
          created_by: teacherId,
        },
        {
          assignment_id: assignments.narrative.id,
          student_id: student1.id,
          entry_kind: 'grading_feedback',
          author_type: 'teacher',
          body: 'Strong descriptive writing and clear structure. Keep tightening the ending so it lands a little more sharply.',
          returned_at: twoDaysAgoIso,
          created_by: teacherId,
        },
        {
          assignment_id: assignments.narrative.id,
          student_id: student2.id,
          entry_kind: 'teacher_feedback',
          author_type: 'teacher',
          body: 'You found a clear moment to write about, but this still needs more detail and revision before it is ready to grade.',
          returned_at: oneDayAgoIso,
          created_by: teacherId,
        },
      ]),
    'Insert narrative feedback history'
  )

  ensureOk(
    await supabase
      .from('assignment_repo_targets')
      .upsert([
        {
          assignment_id: assignments.letter.id,
          student_id: student1.id,
          selected_repo_url: repoUrl,
          override_github_username: 'student1-demo',
          repo_owner: 'codepetca',
          repo_name: 'pika',
          selection_mode: 'teacher_override',
          validation_status: 'valid',
          validation_message: null,
          validated_at: oneDayAgoIso,
        },
        {
          assignment_id: assignments.letter.id,
          student_id: student2.id,
          selected_repo_url: repoUrl,
          override_github_username: null,
          repo_owner: 'codepetca',
          repo_name: 'pika',
          selection_mode: 'auto',
          validation_status: 'valid',
          validation_message: null,
          validated_at: oneDayAgoIso,
        },
      ], { onConflict: 'assignment_id,student_id' }),
    'Upsert assignment repo targets'
  )

  const { data: artifactRun, error: artifactRunError } = await supabase
    .from('assignment_repo_review_runs')
    .insert({
      assignment_id: assignments.letter.id,
      repo_owner: 'codepetca',
      repo_name: 'pika',
      status: 'completed',
      triggered_by: teacherId,
      started_at: oneDayAgoIso,
      completed_at: oneDayAgoIso,
      source_ref: 'main',
      metrics_version: 'v2-seed',
      prompt_version: 'v2-seed',
      model: 'repo-review-v2-seed',
      warnings_json: [],
    })
    .select('id')
    .single()
  ensureOk({ error: artifactRunError }, 'Insert artifact repo review run')
  const createdArtifactRun = ensureData(artifactRun, 'Insert artifact repo review run')

  ensureOk(
    await supabase
      .from('assignment_repo_review_results')
      .insert([
        {
          run_id: createdArtifactRun.id,
          assignment_id: assignments.letter.id,
          student_id: student1.id,
          github_login: 'student1-demo',
          commit_count: 14,
          active_days: 5,
          session_count: 6,
          burst_ratio: 0.26,
          weighted_contribution: 12.4,
          relative_contribution_share: 0.62,
          spread_score: 0.81,
          iteration_score: 0.74,
          semantic_breakdown_json: { feature: 0.55, test: 0.2, docs: 0.1, refactor: 0.15 },
          timeline_json: [
            { date: fiveDaysAgoIso.slice(0, 10), weighted_contribution: 2.1, commit_count: 3 },
            { date: fourDaysAgoIso.slice(0, 10), weighted_contribution: 4.5, commit_count: 5 },
            { date: twoDaysAgoIso.slice(0, 10), weighted_contribution: 5.8, commit_count: 6 },
          ],
          evidence_json: buildRepoEvidence('Implemented submission workflow', 'Built the assignment submission workflow and connected the repo link artifact.', fourDaysAgoIso),
          draft_score_completion: 8,
          draft_score_thinking: 8,
          draft_score_workflow: 7,
          draft_feedback: 'Implemented the submission workflow and owned most of the feature work. Workflow was steady across several days with useful follow-up revisions.',
          confidence: 0.87,
        },
        {
          run_id: createdArtifactRun.id,
          assignment_id: assignments.letter.id,
          student_id: student2.id,
          github_login: 'student2-demo',
          commit_count: 9,
          active_days: 4,
          session_count: 5,
          burst_ratio: 0.33,
          weighted_contribution: 7.6,
          relative_contribution_share: 0.38,
          spread_score: 0.68,
          iteration_score: 0.71,
          semantic_breakdown_json: { test: 0.45, bugfix: 0.25, docs: 0.1, styling: 0.2 },
          timeline_json: [
            { date: fourDaysAgoIso.slice(0, 10), weighted_contribution: 2.2, commit_count: 3 },
            { date: threeDaysAgoIso.slice(0, 10), weighted_contribution: 1.6, commit_count: 2 },
            { date: oneDayAgoIso.slice(0, 10), weighted_contribution: 3.8, commit_count: 4 },
          ],
          evidence_json: buildRepoEvidence('Added tests and QA follow-up', 'Added test coverage and follow-up fixes after review comments.', threeDaysAgoIso),
          draft_score_completion: 6,
          draft_score_thinking: 7,
          draft_score_workflow: 6,
          draft_feedback: 'Contributed testing, follow-up fixes, and review-driven iteration. The work is solid, though the overall contribution was smaller than Student 1’s feature ownership.',
          confidence: 0.83,
        },
      ]),
    'Insert artifact repo review results'
  )
}
