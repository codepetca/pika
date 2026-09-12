export type ClassroomCreationDatabaseError = {
  code?: string | null
  message?: string | null
}

export type ClassroomCreationDenial = {
  status: 403 | 409 | 503
  errorCode:
    | 'classroom_creation_entitlement_disabled'
    | 'classroom_creation_entitlement_not_started'
    | 'classroom_creation_entitlement_expired'
    | 'classroom_creation_active_limit_reached'
    | 'classroom_creation_entitlement_unavailable'
  message: string
  retryable: boolean
}

/**
 * Maps only exact database authorization contracts. Do not expose arbitrary
 * database messages or infer an entitlement denial from a broad SQLSTATE.
 */
export function mapClassroomCreationDatabaseError(
  error: ClassroomCreationDatabaseError | null | undefined,
): ClassroomCreationDenial | null {
  if (!error) return null

  if (error.code === '42501') {
    if (error.message === 'classroom_creation_entitlement_disabled') {
      return {
        status: 403,
        errorCode: error.message,
        message: 'Classroom creation requires Access.',
        retryable: false,
      }
    }
    if (error.message === 'classroom_creation_entitlement_not_started') {
      return {
        status: 403,
        errorCode: error.message,
        message: 'Your classroom creation access is not active yet.',
        retryable: false,
      }
    }
    if (error.message === 'classroom_creation_entitlement_expired') {
      return {
        status: 403,
        errorCode: error.message,
        message: 'Your classroom creation access has expired.',
        retryable: false,
      }
    }
  }

  if (
    error.code === '23514'
    && error.message === 'classroom_creation_active_limit_reached'
  ) {
    return {
      status: 409,
      errorCode: error.message,
      message: 'Archive an active classroom before creating another.',
      retryable: false,
    }
  }

  if (
    error.code === '55000'
    && error.message === 'classroom_creation_entitlement_unavailable'
  ) {
    return {
      status: 503,
      errorCode: error.message,
      message: 'Classroom creation is temporarily unavailable. Please try again.',
      retryable: true,
    }
  }

  return null
}
