/** Import-safe fixed successor evidence; never native admission. */
export const gradeReturnActors = ['ownerStudent','memberTeacher','nonmember','ownerStudent','ownerStudent','memberTeacher','ownerStudent','memberTeacher'] as const
export const gradeReturnLabels = ['vertical-owner-author','vertical-member-submitted','vertical-owner-results','vertical-owner-graded','vertical-owner-returned','vertical-member-returned'] as const
export const gradeReturnStages = ['owner-grade','owner-close-member','owner-grade-readback','member-hidden-before-return','owner-return','owner-return-readback','member-returned-disclosure'] as const
export const verticalGradeComment = 'Reviewed manually'
export const verticalResponseText = 'Synthetic reasoning: Beta is the second option.'
export type GradeReturnIdentity = { testId: string; ownerId: string; memberId: string; questionIds: readonly [string, string];
  mcResponseId: string; mcRevision: number; responseId: string; revision: number }
