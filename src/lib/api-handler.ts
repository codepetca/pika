import { NextRequest, NextResponse } from 'next/server'
import { ZodError } from 'zod'

/**
 * Standard API error response shape.
 */
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * Convenience constructors for common API errors.
 */
export const apiErrors = {
  badRequest: (message: string) => new ApiError(400, message),
  notFound: (message: string) => new ApiError(404, message),
  conflict: (message: string) => new ApiError(409, message),
  tooManyRequests: (message: string) => new ApiError(429, message),
} as const

/**
 * Type for a Next.js route handler function.
 * Supports both simple routes and routes with dynamic params.
 */
type RouteHandler = (
  request: NextRequest,
  context: { params: Promise<Record<string, string>> },
) => Promise<NextResponse>

/**
 * Formats Zod validation errors into a human-readable message.
 */
function formatZodError(error: ZodError): string {
  const messages = error.issues.map(issue => {
    const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
    return `${path}${issue.message}`
  })
  return messages.join('; ')
}

/**
 * Type-guards using error.name — compatible with test mocks that replace
 * @/lib/auth without re-exporting the error classes.
 */
function isAuthenticationError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AuthenticationError'
}

function isAuthorizationError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AuthorizationError'
}

/**
 * Maps known error types to HTTP status codes.
 */
function mapErrorToResponse(error: unknown, routeName: string): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }

  if (error instanceof ZodError) {
    return NextResponse.json({ error: formatZodError(error) }, { status: 400 })
  }

  if (isAuthenticationError(error)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (isAuthorizationError(error)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  console.error(`${routeName} error:`, error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

/**
 * Wraps a Next.js API route handler with standardized error handling.
 *
 * Automatically catches and maps:
 * - AuthenticationError -> 401
 * - AuthorizationError  -> 403
 * - ApiError            -> custom status code
 * - ZodError            -> 400 with field-level messages
 * - Unknown errors      -> 500 (logged to console)
 *
 * @example
 * ```ts
 * // Before (repeated in every route):
 * export async function GET(request: NextRequest) {
 *   try {
 *     const user = await requireRole('teacher')
 *     // ... logic
 *   } catch (error: any) {
 *     if (error.name === 'AuthenticationError') {
 *       return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
 *     }
 *     if (error.name === 'AuthorizationError') {
 *       return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
 *     }
 *     console.error('...', error)
 *     return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
 *   }
 * }
 *
 * // After:
 * export const GET = withErrorHandler('GetClassrooms', async (request) => {
 *   const user = await requireRole('teacher')
 *   // ... logic (just return the happy path)
 * })
 * ```
 */
export function withErrorHandler(routeName: string, handler: RouteHandler): RouteHandler {
  return async (request, context) => {
    try {
      return await handler(request, context)
    } catch (error) {
      return mapErrorToResponse(error, routeName)
    }
  }
}
