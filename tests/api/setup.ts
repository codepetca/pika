/**
 * API Test Setup and Utilities
 * Provides reusable mocking infrastructure for API route tests
 */

import { vi } from 'vitest'

// ============================================================================
// Supabase Mock Builder
// ============================================================================

/**
 * Creates a mock Supabase client with chainable query builder methods
 *
 * Usage:
 * ```typescript
 * const mockClient = createMockSupabaseClient()
 * mockClient.from('entries').select().single.mockResolvedValue({ data: mockEntry, error: null })
 * ```
 */
export const createMockSupabaseClient = () => {
  const mockQueryBuilder = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    like: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    contains: vi.fn().mockReturnThis(),
    containedBy: vi.fn().mockReturnThis(),
    rangeGt: vi.fn().mockReturnThis(),
    rangeGte: vi.fn().mockReturnThis(),
    rangeLt: vi.fn().mockReturnThis(),
    rangeLte: vi.fn().mockReturnThis(),
    rangeAdjacent: vi.fn().mockReturnThis(),
    overlaps: vi.fn().mockReturnThis(),
    textSearch: vi.fn().mockReturnThis(),
    match: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    filter: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    abortSignal: vi.fn().mockReturnThis(),
    single: vi.fn(),
    maybeSingle: vi.fn(),
    then: vi.fn(), // For promise-like behavior
  }

  return {
    from: vi.fn(() => mockQueryBuilder),
    rpc: vi.fn(() => mockQueryBuilder),
    auth: {
      getSession: vi.fn(),
      signIn: vi.fn(),
      signOut: vi.fn(),
      signUp: vi.fn(),
    },
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn(),
        download: vi.fn(),
        list: vi.fn(),
        remove: vi.fn(),
      })),
    },
  }
}

// ============================================================================
// Session Mocking Helpers
// ============================================================================

/**
 * Mock a student session
 */
export const mockStudentSession = (
  userId: string = 'student-1',
  email: string = 'test@student.com',
  overrides: Record<string, any> = {}
) => ({
  user: {
    id: userId,
    email,
    role: 'student' as const,
    ...overrides,
  },
})

/**
 * Mock a teacher session
 */
export const mockTeacherSession = (
  userId: string = 'teacher-1',
  email: string = 'test@gapps.yrdsb.ca',
  overrides: Record<string, any> = {}
) => ({
  user: {
    id: userId,
    email,
    role: 'teacher' as const,
    ...overrides,
  },
})

/**
 * Mock an empty/unauthenticated session
 */
export const mockNoSession = () => ({
  user: null,
})

// ============================================================================
// Request/Response Mocking
// ============================================================================

/**
 * Create a mock Next.js Request object
 */
export const mockRequest = (
  method: string = 'GET',
  body?: any,
  headers: Record<string, string> = {}
): Request => {
  const url = 'http://localhost:3000/api/test'

  return {
    method,
    headers: new Headers(headers),
    url,
    json: async () => body,
    text: async () => JSON.stringify(body),
    body: body ? JSON.stringify(body) : null,
  } as Request
}

/**
 * Create a mock Next.js Response object for testing
 */
export const mockResponse = () => {
  const response = {
    status: 200,
    headers: new Map<string, string>(),
    body: null as any,
  }

  return {
    json: (data: any, init?: ResponseInit) => {
      response.status = init?.status || 200
      response.body = data
      return Response.json(data, init)
    },
    text: (data: string, init?: ResponseInit) => {
      response.status = init?.status || 200
      response.body = data
      return new Response(data, init)
    },
    redirect: (url: string, init?: ResponseInit) => {
      response.status = init?.status || 302
      response.headers.set('Location', url)
      return Response.redirect(url, init)
    },
    _getResponse: () => response,
  }
}

// ============================================================================
// Common Mock Patterns
// ============================================================================

/**
 * Mock the auth module for testing authenticated routes
 */
export const mockAuthModule = () => {
  return {
    getSession: vi.fn(),
    createSession: vi.fn(),
    destroySession: vi.fn(),
    getCurrentUser: vi.fn(),
    requireAuth: vi.fn(),
    requireRole: vi.fn(),
    isTeacherEmail: vi.fn(),
  }
}

/**
 * Mock the Supabase module
 */
export const mockSupabaseModule = () => {
  const mockClient = createMockSupabaseClient()
  return {
    getServiceRoleClient: vi.fn(() => mockClient),
    supabase: mockClient,
  }
}

/**
 * Mock the crypto module for testing code generation/hashing
 */
export const mockCryptoModule = () => {
  return {
    generateVerificationCode: vi.fn(() => 'ABC12'),
    hashCode: vi.fn(async (code: string) => `hashed_${code}`),
    verifyCode: vi.fn(async (code: string, hash: string) => hash === `hashed_${code}`),
    hashPassword: vi.fn(async (password: string) => `hashed_${password}`),
    verifyPassword: vi.fn(async (password: string, hash: string) => hash === `hashed_${password}`),
    validatePassword: vi.fn((password: string) => password.length >= 8),
  }
}

/**
 * Mock the email module
 */
export const mockEmailModule = () => {
  return {
    sendSignupCode: vi.fn(),
    sendPasswordResetCode: vi.fn(),
  }
}

// ============================================================================
// Test Data Builders for API Responses
// ============================================================================

/**
 * Build a Supabase query result
 */
export const buildSupabaseResult = <T>(data: T, error: any = null) => ({
  data,
  error,
  count: Array.isArray(data) ? data.length : null,
  status: error ? 400 : 200,
  statusText: error ? 'Bad Request' : 'OK',
})

/**
 * Build a Supabase error result
 */
export const buildSupabaseError = (message: string, code: string = 'PGRST116') => ({
  data: null,
  error: {
    message,
    code,
    details: null,
    hint: null,
  },
  count: null,
  status: 400,
  statusText: 'Bad Request',
})

/**
 * Build a rate limit error
 */
export const buildRateLimitError = () => ({
  error: 'Too many requests. Please try again later.',
  retryAfter: 3600, // 1 hour in seconds
})

/**
 * Build an unauthorized error
 */
export const buildUnauthorizedError = () => ({
  error: 'Unauthorized',
})

/**
 * Build a forbidden error
 */
export const buildForbiddenError = () => ({
  error: 'Forbidden',
})

// ============================================================================
// Assertion Helpers
// ============================================================================

/**
 * Assert that a response has the expected status code
 */
export const expectStatus = (response: Response, expectedStatus: number) => {
  expect(response.status).toBe(expectedStatus)
}

/**
 * Assert that a response is a JSON response with expected data
 */
export const expectJsonResponse = async (response: Response, expectedData: any) => {
  const data = await response.json()
  expect(data).toEqual(expectedData)
}

/**
 * Assert that a response is an error response
 */
export const expectErrorResponse = async (
  response: Response,
  expectedStatus: number,
  expectedMessage?: string
) => {
  expect(response.status).toBe(expectedStatus)
  const data = await response.json()
  expect(data).toHaveProperty('error')
  if (expectedMessage) {
    expect(data.error).toContain(expectedMessage)
  }
}

// ============================================================================
// Error Mock Helpers
// ============================================================================

/**
 * Create an AuthenticationError for testing 401 responses
 */
export const mockAuthenticationError = () => {
  const error = new Error('Not authenticated')
  error.name = 'AuthenticationError'
  return error
}

/**
 * Create an AuthorizationError for testing 403 responses
 */
export const mockAuthorizationError = (message: string = 'Forbidden') => {
  const error = new Error(message)
  error.name = 'AuthorizationError'
  return error
}

// ============================================================================
// Setup/Teardown Helpers
// ============================================================================

/**
 * Clear all mocks between tests
 */
export const clearAllMocks = () => {
  vi.clearAllMocks()
}

/**
 * Reset all mocks to initial state
 */
export const resetAllMocks = () => {
  vi.resetAllMocks()
}

/**
 * Restore all mocks to original implementations
 */
export const restoreAllMocks = () => {
  vi.restoreAllMocks()
}
