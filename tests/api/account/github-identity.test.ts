/**
 * API tests for GET/PATCH /api/account/github-identity
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { mockAuthenticationError } from '../setup'
import { makeQueryBuilder } from '../../support/supabase'

const mocks = vi.hoisted(() => ({
  getServiceRoleClient: vi.fn(),
  isMissingAssignmentSubmissionSchemaError: vi.fn(),
  loadUserGitHubIdentity: vi.fn(),
  requireAuth: vi.fn(),
  validateGitHubLogin: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  requireAuth: mocks.requireAuth,
}))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: mocks.getServiceRoleClient,
}))

vi.mock('@/lib/server/assignment-submission-artifacts', () => ({
  isMissingAssignmentSubmissionSchemaError: mocks.isMissingAssignmentSubmissionSchemaError,
  loadUserGitHubIdentity: mocks.loadUserGitHubIdentity,
}))

vi.mock('@/lib/server/assignment-submission-validation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/assignment-submission-validation')>()
  return {
    ...actual,
    validateGitHubLogin: mocks.validateGitHubLogin,
  }
})

import { GET, PATCH } from '@/app/api/account/github-identity/route'

let mockSupabase: { from: ReturnType<typeof vi.fn> }

function getRequest() {
  return new NextRequest('http://localhost:3000/api/account/github-identity')
}

function patchRequest(body: unknown) {
  return new NextRequest('http://localhost:3000/api/account/github-identity', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

describe('/api/account/github-identity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()

    mockSupabase = { from: vi.fn() }
    mocks.getServiceRoleClient.mockReturnValue(mockSupabase)
    mocks.requireAuth.mockResolvedValue({
      id: 'user-1',
      email: 'student@example.com',
      role: 'student',
    })
    mocks.isMissingAssignmentSubmissionSchemaError.mockReturnValue(false)
  })

  describe('GET', () => {
    it('returns 401 when the user is not authenticated', async () => {
      mocks.requireAuth.mockRejectedValueOnce(mockAuthenticationError())

      const response = await GET(getRequest(), {} as any)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data).toEqual({ error: 'Unauthorized' })
      expect(mocks.getServiceRoleClient).not.toHaveBeenCalled()
      expect(mocks.loadUserGitHubIdentity).not.toHaveBeenCalled()
    })

    it('returns the authenticated user GitHub identity', async () => {
      const identity = {
        user_id: 'user-1',
        github_login: 'student-dev',
        validation_status: 'valid',
        validation_message: null,
      }
      mocks.loadUserGitHubIdentity.mockResolvedValueOnce(identity)

      const response = await GET(getRequest(), {} as any)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(mocks.getServiceRoleClient).toHaveBeenCalledTimes(1)
      expect(mocks.loadUserGitHubIdentity).toHaveBeenCalledWith(mockSupabase, 'user-1')
      expect(data).toEqual({ identity })
    })

    it('returns null when the authenticated user has no GitHub identity', async () => {
      mocks.loadUserGitHubIdentity.mockResolvedValueOnce(null)

      const response = await GET(getRequest(), {} as any)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual({ identity: null })
    })
  })

  describe('PATCH', () => {
    it('returns 401 before validating or saving when the user is not authenticated', async () => {
      mocks.requireAuth.mockRejectedValueOnce(mockAuthenticationError())

      const response = await PATCH(patchRequest({ github_login: 'student-dev' }), {} as any)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data).toEqual({ error: 'Unauthorized' })
      expect(mocks.validateGitHubLogin).not.toHaveBeenCalled()
      expect(mocks.getServiceRoleClient).not.toHaveBeenCalled()
    })

    it.each([
      ['missing login', {}],
      ['non-string login', { github_login: 42 }],
      ['blank login', { github_login: '   ' }],
      ['invalid characters', { github_login: 'student/dev' }],
      ['leading hyphen', { github_login: '-student' }],
      ['trailing hyphen', { github_login: 'student-' }],
    ])('rejects %s without validating against GitHub or saving', async (_label, body) => {
      const response = await PATCH(patchRequest(body), {} as any)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data).toEqual({ error: 'Enter a valid GitHub username.' })
      expect(mocks.validateGitHubLogin).not.toHaveBeenCalled()
      expect(mocks.getServiceRoleClient).not.toHaveBeenCalled()
    })

    it('normalizes a valid username and saves the GitHub validation result', async () => {
      const now = new Date('2026-05-26T12:34:56.789Z')
      vi.useFakeTimers()
      vi.setSystemTime(now)

      const identity = {
        user_id: 'user-1',
        github_login: 'student-dev',
        validation_status: 'valid',
        validation_message: null,
        validated_at: now.toISOString(),
      }
      const upsertBuilder = makeQueryBuilder({ data: identity, error: null })
      mockSupabase.from.mockReturnValueOnce(upsertBuilder)
      mocks.validateGitHubLogin.mockResolvedValueOnce({
        validation_status: 'valid',
        validation_message: null,
      })

      const response = await PATCH(patchRequest({ github_login: ' @student-dev ' }), {} as any)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(mocks.validateGitHubLogin).toHaveBeenCalledWith('student-dev')
      expect(mockSupabase.from).toHaveBeenCalledWith('user_github_identities')
      expect(upsertBuilder.upsert).toHaveBeenCalledWith({
        user_id: 'user-1',
        github_login: 'student-dev',
        validation_status: 'valid',
        validation_message: null,
        validated_at: now.toISOString(),
      }, { onConflict: 'user_id' })
      expect(upsertBuilder.select).toHaveBeenCalledWith('*')
      expect(upsertBuilder.single).toHaveBeenCalled()
      expect(data).toEqual({ identity })
    })

    it.each([
      ['invalid', 'GitHub username was not found.'],
      ['inaccessible', 'GitHub validation is temporarily unavailable.'],
    ] as const)('saves %s GitHub validation outcomes for valid username formats', async (status, message) => {
      const identity = {
        user_id: 'user-1',
        github_login: 'student-dev',
        validation_status: status,
        validation_message: message,
      }
      const upsertBuilder = makeQueryBuilder({ data: identity, error: null })
      mockSupabase.from.mockReturnValueOnce(upsertBuilder)
      mocks.validateGitHubLogin.mockResolvedValueOnce({
        validation_status: status,
        validation_message: message,
      })

      const response = await PATCH(patchRequest({ github_login: 'student-dev' }), {} as any)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(upsertBuilder.upsert).toHaveBeenCalledWith(expect.objectContaining({
        github_login: 'student-dev',
        validation_status: status,
        validation_message: message,
      }), { onConflict: 'user_id' })
      expect(data).toEqual({ identity })
    })

    it('returns 503 when GitHub identity storage is unavailable', async () => {
      const schemaError = { code: 'PGRST205', message: 'schema cache missing user_github_identities' }
      const upsertBuilder = makeQueryBuilder({ data: null, error: schemaError })
      mockSupabase.from.mockReturnValueOnce(upsertBuilder)
      mocks.validateGitHubLogin.mockResolvedValueOnce({
        validation_status: 'valid',
        validation_message: null,
      })
      mocks.isMissingAssignmentSubmissionSchemaError.mockReturnValueOnce(true)

      const response = await PATCH(patchRequest({ github_login: 'student-dev' }), {} as any)
      const data = await response.json()

      expect(response.status).toBe(503)
      expect(data).toEqual({ error: 'GitHub identity storage is not available yet.' })
      expect(mocks.isMissingAssignmentSubmissionSchemaError).toHaveBeenCalledWith(schemaError)
    })

    it('returns 500 when saving the GitHub identity fails unexpectedly', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      const upsertBuilder = makeQueryBuilder({ data: null, error: { message: 'database unavailable' } })
      mockSupabase.from.mockReturnValueOnce(upsertBuilder)
      mocks.validateGitHubLogin.mockResolvedValueOnce({
        validation_status: 'valid',
        validation_message: null,
      })

      const response = await PATCH(patchRequest({ github_login: 'student-dev' }), {} as any)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data).toEqual({ error: 'Internal server error' })
      expect(consoleError).toHaveBeenCalled()

      consoleError.mockRestore()
    })
  })
})
