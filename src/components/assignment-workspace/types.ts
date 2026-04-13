import type {
  Assignment,
  AssignmentDoc,
  AssignmentFeedbackEntry,
  AssignmentRepoReviewResult,
  AssignmentRepoTarget,
  AssignmentRepoTargetSelectionMode,
  AssignmentRepoTargetValidationStatus,
  AssignmentStatus,
} from '@/types'

export type InspectorSectionId = 'history' | 'repo' | 'grades' | 'comments'

export interface StudentWorkData {
  assignment: Assignment
  classroom: { id: string; title: string }
  student: { id: string; email: string; name: string | null }
  doc: AssignmentDoc | null
  status: AssignmentStatus
  feedback_entries: AssignmentFeedbackEntry[]
  repo_target: {
    target: AssignmentRepoTarget | null
    submittedRepoUrl: string | null
    submittedGitHubUsername: string | null
    effectiveRepoUrl: string | null
    effectiveGitHubUsername: string | null
    repoOwner: string | null
    repoName: string | null
    selectionMode: AssignmentRepoTargetSelectionMode
    validationStatus: AssignmentRepoTargetValidationStatus
    validationMessage: string | null
    latest_result: AssignmentRepoReviewResult | null
  }
}
