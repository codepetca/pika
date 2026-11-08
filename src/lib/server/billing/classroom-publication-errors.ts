import { ApiError } from '@/lib/api-error'

export function throwBillingClassroomPublicationError(error: { code?: string; message?: string } | null): void {
  if (error?.code === 'PT403' && error.message === 'billing_classroom_new_work_unavailable') {
    throw new ApiError(403, 'Assignment release is unavailable for this classroom.')
  }
  if (error?.code === 'PT409' && error.message === 'billing_assignment_publication_busy') {
    throw new ApiError(409, 'Assignment changed during this update. Refresh and try again.')
  }
}
