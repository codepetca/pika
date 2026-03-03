import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { withErrorHandler, ApiError, apiErrors } from '@/lib/api-handler'
import { AuthenticationError, AuthorizationError } from '@/lib/auth'

// Suppress console.error in tests
vi.spyOn(console, 'error').mockImplementation(() => {})

describe('withErrorHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes through successful responses unchanged', async () => {
    const handler = withErrorHandler('TestRoute', async () => {
      return NextResponse.json({ success: true }, { status: 200 })
    })

    const request = new NextRequest('http://localhost/api/test')
    const result = await handler(request, { params: Promise.resolve({}) })
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body).toEqual({ success: true })
  })

  it('maps AuthenticationError to 401', async () => {
    const handler = withErrorHandler('TestRoute', async () => {
      throw new AuthenticationError('Not authenticated')
    })

    const request = new NextRequest('http://localhost/api/test')
    const result = await handler(request, { params: Promise.resolve({}) })
    const body = await result.json()

    expect(result.status).toBe(401)
    expect(body).toEqual({ error: 'Unauthorized' })
  })

  it('maps AuthorizationError to 403', async () => {
    const handler = withErrorHandler('TestRoute', async () => {
      throw new AuthorizationError('Forbidden')
    })

    const request = new NextRequest('http://localhost/api/test')
    const result = await handler(request, { params: Promise.resolve({}) })
    const body = await result.json()

    expect(result.status).toBe(403)
    expect(body).toEqual({ error: 'Forbidden' })
  })

  it('maps ApiError to the specified status code', async () => {
    const handler = withErrorHandler('TestRoute', async () => {
      throw new ApiError(400, 'Email is required')
    })

    const request = new NextRequest('http://localhost/api/test')
    const result = await handler(request, { params: Promise.resolve({}) })
    const body = await result.json()

    expect(result.status).toBe(400)
    expect(body).toEqual({ error: 'Email is required' })
  })

  it('maps unknown errors to 500 and logs them', async () => {
    const unknownError = new Error('Something went wrong')
    const handler = withErrorHandler('TestRoute', async () => {
      throw unknownError
    })

    const request = new NextRequest('http://localhost/api/test')
    const result = await handler(request, { params: Promise.resolve({}) })
    const body = await result.json()

    expect(result.status).toBe(500)
    expect(body).toEqual({ error: 'Internal server error' })
    expect(console.error).toHaveBeenCalledWith('TestRoute error:', unknownError)
  })

  it('includes route name in error log', async () => {
    const handler = withErrorHandler('GetClassrooms', async () => {
      throw new Error('DB timeout')
    })

    const request = new NextRequest('http://localhost/api/test')
    await handler(request, { params: Promise.resolve({}) })

    expect(console.error).toHaveBeenCalledWith(
      'GetClassrooms error:',
      expect.any(Error)
    )
  })

  it('does not log AuthenticationError or AuthorizationError', async () => {
    const authHandler = withErrorHandler('TestRoute', async () => {
      throw new AuthenticationError()
    })

    const request = new NextRequest('http://localhost/api/test')
    await authHandler(request, { params: Promise.resolve({}) })

    expect(console.error).not.toHaveBeenCalled()
  })

  it('maps ZodError to 400 with field-level messages', async () => {
    const schema = z.object({
      email: z.string().email(),
      password: z.string().min(8, 'Password must be at least 8 characters'),
    })

    const handler = withErrorHandler('TestRoute', async () => {
      schema.parse({ email: 'not-an-email', password: 'short' })
      return NextResponse.json({})
    })

    const request = new NextRequest('http://localhost/api/test')
    const result = await handler(request, { params: Promise.resolve({}) })
    const body = await result.json()

    expect(result.status).toBe(400)
    expect(body.error).toContain('email')
    expect(body.error).toContain('password')
  })

  it('formats ZodError with field paths', async () => {
    const schema = z.object({
      name: z.string().min(1, 'Name is required'),
    })

    const handler = withErrorHandler('TestRoute', async () => {
      schema.parse({ name: '' })
      return NextResponse.json({})
    })

    const request = new NextRequest('http://localhost/api/test')
    const result = await handler(request, { params: Promise.resolve({}) })
    const body = await result.json()

    expect(result.status).toBe(400)
    expect(body.error).toContain('name: Name is required')
  })

  it('does not log ZodError', async () => {
    const handler = withErrorHandler('TestRoute', async () => {
      z.string().parse(123)
      return NextResponse.json({})
    })

    const request = new NextRequest('http://localhost/api/test')
    await handler(request, { params: Promise.resolve({}) })

    expect(console.error).not.toHaveBeenCalled()
  })

  it('does not log ApiError (4xx)', async () => {
    const handler = withErrorHandler('TestRoute', async () => {
      throw new ApiError(400, 'Bad request')
    })

    const request = new NextRequest('http://localhost/api/test')
    await handler(request, { params: Promise.resolve({}) })

    expect(console.error).not.toHaveBeenCalled()
  })

  it('forwards request and params to the inner handler', async () => {
    const innerHandler = vi.fn(async (_request: NextRequest, context: any) => {
      const params = await context.params
      return NextResponse.json({ id: params.id })
    })

    const handler = withErrorHandler('TestRoute', innerHandler)
    const request = new NextRequest('http://localhost/api/test/123')
    const params = Promise.resolve({ id: '123' })

    const result = await handler(request, { params })
    const body = await result.json()

    expect(innerHandler).toHaveBeenCalledWith(request, { params })
    expect(body).toEqual({ id: '123' })
  })
})

describe('apiErrors helpers', () => {
  it('badRequest creates 400 ApiError', () => {
    const error = apiErrors.badRequest('Missing field')
    expect(error).toBeInstanceOf(ApiError)
    expect(error.statusCode).toBe(400)
    expect(error.message).toBe('Missing field')
  })

  it('notFound creates 404 ApiError', () => {
    const error = apiErrors.notFound('Classroom not found')
    expect(error).toBeInstanceOf(ApiError)
    expect(error.statusCode).toBe(404)
    expect(error.message).toBe('Classroom not found')
  })

  it('conflict creates 409 ApiError', () => {
    const error = apiErrors.conflict('Already exists')
    expect(error).toBeInstanceOf(ApiError)
    expect(error.statusCode).toBe(409)
    expect(error.message).toBe('Already exists')
  })

  it('tooManyRequests creates 429 ApiError', () => {
    const error = apiErrors.tooManyRequests('Rate limited')
    expect(error).toBeInstanceOf(ApiError)
    expect(error.statusCode).toBe(429)
    expect(error.message).toBe('Rate limited')
  })
})

describe('ApiError', () => {
  it('has the correct name property', () => {
    const error = new ApiError(400, 'test')
    expect(error.name).toBe('ApiError')
  })

  it('is an instance of Error', () => {
    const error = new ApiError(400, 'test')
    expect(error).toBeInstanceOf(Error)
  })
})
