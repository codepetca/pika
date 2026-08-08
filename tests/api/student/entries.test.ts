/**
 * API tests for GET/POST /api/student/entries
 * Tests student journal entry creation and retrieval
 */

import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest'
import { GET, POST, PATCH } from '@/app/api/student/entries/route'
import { NextRequest } from 'next/server'
import { mockAuthenticationError } from '../setup'
import { createJsonPatch } from '@/lib/json-patch'
import type { TiptapContent } from '@/types'

const { mockAttemptImmediatePalEventDelivery } = vi.hoisted(() => ({
  mockAttemptImmediatePalEventDelivery: vi.fn(async () => 'delivered'),
}))

// Mock modules
vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async (role: string) => {
    if (role === 'student') {
      return { id: 'student-1', email: 'test@student.com', role: 'student' }
    }
    throw new Error('Unauthorized')
  }),
}))

vi.mock('@/lib/timezone', () => ({
  isOnTime: vi.fn((now: Date, date: string) => {
    // Mock: entries created before midnight Toronto time are on time
    const entryDate = new Date(date)
    return now.getTime() <= entryDate.getTime() + 24 * 60 * 60 * 1000
  }),
  getTodayInToronto: vi.fn(() => '2024-10-15'),
}))
vi.mock('@/lib/server/classrooms', () => ({
  assertStudentCanAccessClassroom: vi.fn(async () => ({
    ok: true,
    classroom: { id: 'classroom-1', archived_at: null },
  })),
}))
vi.mock('@/lib/server/pal-outbox', () => ({
  attemptImmediatePalEventDelivery: mockAttemptImmediatePalEventDelivery,
}))

const mockSupabaseClient = { from: vi.fn() }

afterEach(() => {
  vi.unstubAllEnvs()
  delete (mockSupabaseClient as any).rpc
})

describe('GET /api/student/entries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('authorization', () => {
    it('should return 401 when user is not authenticated', async () => {
      const { requireRole } = await import('@/lib/auth')
      ;(requireRole as any).mockRejectedValueOnce(mockAuthenticationError())

      const request = new NextRequest('http://localhost:3000/api/student/entries')

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })
  })

  describe('fetching entries', () => {
    it('defaults broad active-classroom entry reads to a safe limit', async () => {
      const limitMock = vi.fn((limit: number) => ({
        order: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'entry-1',
              student_id: 'student-1',
              classroom_id: 'classroom-1',
              date: '2024-10-15',
              text: 'Entry 1',
              on_time: true,
            },
            {
              id: 'entry-2',
              student_id: 'student-1',
              classroom_id: 'classroom-1',
              date: '2024-10-14',
              text: 'Entry 2',
              on_time: true,
            },
          ],
          error: null,
        }),
      }))
      const mockFrom = vi.fn((table: string) => {
        if (table === 'classroom_enrollments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                is: vi.fn(() => ({
                  data: [{ classroom_id: 'classroom-1' }],
                  error: null,
                })),
              })),
            })),
          }
        }
        if (table === 'entries') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn(() => ({
                  limit: limitMock,
                })),
              })),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/student/entries')

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.entries).toHaveLength(2)
      expect(data.entries[0].id).toBe('entry-1')
      expect(limitMock).toHaveBeenCalledWith(100)
    })

    it('caps explicit broad active-classroom entry limits at 100', async () => {
      const limitMock = vi.fn((limit: number) => ({
        order: vi.fn().mockResolvedValue({
          data: [],
          error: null,
        }),
      }))
      const mockFrom = vi.fn((table: string) => {
        if (table === 'classroom_enrollments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                is: vi.fn(() => ({
                  data: [{ classroom_id: 'classroom-1' }],
                  error: null,
                })),
              })),
            })),
          }
        }
        if (table === 'entries') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn(() => ({
                  limit: limitMock,
                })),
              })),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/student/entries?limit=500')

      const response = await GET(request)

      expect(response.status).toBe(200)
      expect(limitMock).toHaveBeenCalledWith(100)
    })

    it('should filter entries by classroom_id when provided', async () => {
      // Create a mock query object that is both chainable and thenable
      const mockQuery = {
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        then: vi.fn((resolve: any) => resolve({
          data: [{ id: 'entry-1', classroom_id: 'classroom-2' }],
          error: null
        }))
      }

      const mockFrom = vi.fn(() => ({
        select: vi.fn(() => mockQuery),
      }))
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/student/entries?classroom_id=classroom-2')

      await GET(request)

      // Verify eq was called twice: once for student_id, once for classroom_id
      expect(mockQuery.eq).toHaveBeenCalledWith('student_id', 'student-1')
      expect(mockQuery.eq).toHaveBeenCalledWith('classroom_id', 'classroom-2')
      expect(mockQuery.limit).not.toHaveBeenCalled()
    })

    it('applies explicit classroom-scoped limits', async () => {
      const mockQuery = {
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        then: vi.fn((resolve: any) => resolve({
          data: [{ id: 'entry-1', classroom_id: 'classroom-2' }],
          error: null,
        })),
      }

      const mockFrom = vi.fn(() => ({
        select: vi.fn(() => mockQuery),
      }))
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/student/entries?classroom_id=classroom-2&limit=12')

      await GET(request)

      expect(mockQuery.limit).toHaveBeenCalledWith(12)
    })

    it('should return 500 when database query fails', async () => {
      const limitMock = vi.fn((limit: number) => ({
        order: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'Database error' },
        }),
      }))
      const mockFrom = vi.fn((table: string) => {
        if (table === 'classroom_enrollments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                is: vi.fn(() => ({
                  data: [{ classroom_id: 'classroom-1' }],
                  error: null,
                })),
              })),
            })),
          }
        }
        if (table === 'entries') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn(() => ({
                  limit: limitMock,
                })),
              })),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/student/entries')

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to fetch entries')
    })
  })
})

describe('POST /api/student/entries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('authorization', () => {
    it('should return 401 when user is not authenticated', async () => {
      const { requireRole } = await import('@/lib/auth')
      ;(requireRole as any).mockRejectedValueOnce(mockAuthenticationError())

      const request = new NextRequest('http://localhost:3000/api/student/entries', {
        method: 'POST',
        body: JSON.stringify({
          classroom_id: 'classroom-1',
          date: '2024-10-15',
          text: 'Test entry',
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })
  })

  describe('validation', () => {
    it('should return 400 when classroom_id is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/student/entries', {
        method: 'POST',
        body: JSON.stringify({
          date: '2024-10-15',
          text: 'Test entry',
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('classroom_id and date are required')
    })

    it('should return 400 when date is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/student/entries', {
        method: 'POST',
        body: JSON.stringify({
          classroom_id: 'classroom-1',
          text: 'Test entry',
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('classroom_id and date are required')
    })

    it('should return 400 when date format is invalid', async () => {
      const request = new NextRequest('http://localhost:3000/api/student/entries', {
        method: 'POST',
        body: JSON.stringify({
          classroom_id: 'classroom-1',
          date: '10/15/2024',
          text: 'Test entry',
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid date format (use YYYY-MM-DD)')
    })

    it('should return 400 when mood is invalid', async () => {
      const request = new NextRequest('http://localhost:3000/api/student/entries', {
        method: 'POST',
        body: JSON.stringify({
          classroom_id: 'classroom-1',
          date: '2024-10-15',
          text: 'Test entry',
          mood: '😡', // Invalid mood
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid mood value')
    })

    it('should accept valid moods (😊, 🙂, 😐)', async () => {
      const mockFrom = vi.fn((table: string) => {
        if (table === 'classroom_enrollments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: { id: 'enrollment-1' },
                error: null,
              }),
            })),
          }
        } else if (table === 'class_days') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: { is_class_day: true },
                error: null,
              }),
            })),
          }
        } else if (table === 'entries') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ data: null, error: null }),
            })),
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'entry-1', mood: '😊' },
                  error: null,
                }),
              })),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/student/entries', {
        method: 'POST',
        body: JSON.stringify({
          classroom_id: 'classroom-1',
          date: '2024-10-15',
          text: 'Test entry',
          mood: '😊',
        }),
      })

      const response = await POST(request)
      expect(response.status).toBe(200)
    })
  })

  describe('enrollment verification', () => {
    it('should return 403 when student is not enrolled in classroom', async () => {
      const { assertStudentCanAccessClassroom } = await import('@/lib/server/classrooms')
      ;(assertStudentCanAccessClassroom as any).mockResolvedValueOnce({
        ok: false,
        status: 403,
        error: 'Not enrolled in this classroom',
      })

      const request = new NextRequest('http://localhost:3000/api/student/entries', {
        method: 'POST',
        body: JSON.stringify({
          classroom_id: 'classroom-999',
          date: '2024-10-15',
          text: 'Test entry',
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data.error).toBe('Not enrolled in this classroom')
    })
  })

  describe('date + class day enforcement', () => {
    it('should return 400 when date is in the future (Toronto)', async () => {
      const { getTodayInToronto } = await import('@/lib/timezone')
      ;(getTodayInToronto as any).mockReturnValueOnce('2024-10-14')

      const mockFrom = vi.fn((table: string) => {
        if (table === 'classroom_enrollments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: { id: 'enrollment-1' },
                error: null,
              }),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/student/entries', {
        method: 'POST',
        body: JSON.stringify({
          classroom_id: 'classroom-1',
          date: '2024-10-15',
          text: 'Test entry',
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Cannot submit entries for future dates')
    })

    it('should return 400 when date is not a class day', async () => {
      const mockFrom = vi.fn((table: string) => {
        if (table === 'classroom_enrollments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: { id: 'enrollment-1' },
                error: null,
              }),
            })),
          }
        } else if (table === 'class_days') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: { is_class_day: false },
                error: null,
              }),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/student/entries', {
        method: 'POST',
        body: JSON.stringify({
          classroom_id: 'classroom-1',
          date: '2024-10-15',
          text: 'Test entry',
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Not a class day')
    })
  })

  describe('entry creation', () => {
    it('should create new entry when none exists', async () => {
      const mockInsert = vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'entry-new-1',
              student_id: 'student-1',
              classroom_id: 'classroom-1',
              date: '2024-10-15',
              text: 'Test entry',
              on_time: true,
            },
            error: null,
          }),
        })),
      }))

      const mockFrom = vi.fn((table: string) => {
        if (table === 'classroom_enrollments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: { id: 'enrollment-1' },
                error: null,
              }),
            })),
          }
        } else if (table === 'class_days') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: { is_class_day: true },
                error: null,
              }),
            })),
          }
        } else if (table === 'entries') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ data: null, error: null }),
            })),
            insert: mockInsert,
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/student/entries', {
        method: 'POST',
        body: JSON.stringify({
          classroom_id: 'classroom-1',
          date: '2024-10-15',
          text: 'Test entry',
          minutes_reported: 60,
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.entry.id).toBe('entry-new-1')
      expect(mockInsert).toHaveBeenCalledWith({
        student_id: 'student-1',
        classroom_id: 'classroom-1',
        date: '2024-10-15',
        text: 'Test entry',
        rich_content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Test entry' }],
            },
          ],
        },
        minutes_reported: 60,
        mood: undefined,
        on_time: expect.any(Boolean),
      })
    })

    it('should update existing entry when one exists', async () => {
      const mockUpdate = vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'entry-existing-1',
                text: 'Updated entry',
                on_time: true,
              },
              error: null,
            }),
          })),
        })),
      }))

      const mockFrom = vi.fn((table: string) => {
        if (table === 'classroom_enrollments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: { id: 'enrollment-1' },
                error: null,
              }),
            })),
          }
        } else if (table === 'class_days') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: { is_class_day: true },
                error: null,
              }),
            })),
          }
        } else if (table === 'entries') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValueOnce({
                data: { id: 'entry-existing-1' },
                error: null,
              }),
            })),
            update: mockUpdate,
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/student/entries', {
        method: 'POST',
        body: JSON.stringify({
          classroom_id: 'classroom-1',
          date: '2024-10-15',
          text: 'Updated entry',
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.entry.id).toBe('entry-existing-1')
      expect(data.entry.text).toBe('Updated entry')
      expect(mockUpdate).toHaveBeenCalledWith({
        text: 'Updated entry',
        rich_content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Updated entry' }],
            },
          ],
        },
        minutes_reported: undefined,
        mood: undefined,
        on_time: expect.any(Boolean),
        version: expect.any(Number),
      })
    })

    it('should calculate on_time status using isOnTime', async () => {
      const { isOnTime } = await import('@/lib/timezone')

      const mockFrom = vi.fn((table: string) => {
        if (table === 'classroom_enrollments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: { id: 'enrollment-1' },
                error: null,
              }),
            })),
          }
        } else if (table === 'class_days') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: { is_class_day: true },
                error: null,
              }),
            })),
          }
        } else if (table === 'entries') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ data: null, error: null }),
            })),
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'entry-1' },
                  error: null,
                }),
              })),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/student/entries', {
        method: 'POST',
        body: JSON.stringify({
          classroom_id: 'classroom-1',
          date: '2024-10-15',
          text: 'Test entry',
        }),
      })

      await POST(request)

      expect(isOnTime).toHaveBeenCalledWith(expect.any(Date), '2024-10-15')
    })

    it('should recalculate on_time when updating entry', async () => {
      const { isOnTime } = await import('@/lib/timezone')

      const mockFrom = vi.fn((table: string) => {
        if (table === 'classroom_enrollments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: { id: 'enrollment-1' },
                error: null,
              }),
            })),
          }
        } else if (table === 'class_days') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: { is_class_day: true },
                error: null,
              }),
            })),
          }
        } else if (table === 'entries') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValueOnce({
                data: { id: 'entry-1' },
                error: null,
              }),
            })),
            update: vi.fn(() => ({
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    data: { id: 'entry-1' },
                    error: null,
                  }),
                })),
              })),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/student/entries', {
        method: 'POST',
        body: JSON.stringify({
          classroom_id: 'classroom-1',
          date: '2024-10-15',
          text: 'Updated entry',
        }),
      })

      await POST(request)

      expect(isOnTime).toHaveBeenCalledWith(expect.any(Date), '2024-10-15')
    })
  })

  describe('error handling', () => {
    it('should return 500 when creating entry fails', async () => {
      const mockFrom = vi.fn((table: string) => {
        if (table === 'classroom_enrollments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: { id: 'enrollment-1' },
                error: null,
              }),
            })),
          }
        } else if (table === 'class_days') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: { is_class_day: true },
                error: null,
              }),
            })),
          }
        } else if (table === 'entries') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ data: null, error: null }),
            })),
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: 'Insert failed' },
                }),
              })),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/student/entries', {
        method: 'POST',
        body: JSON.stringify({
          classroom_id: 'classroom-1',
          date: '2024-10-15',
          text: 'Test entry',
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to create entry')
    })

    it('preserves omitted mood and minutes on a Pal-enabled POST update', async () => {
      vi.stubEnv('PAL_ENABLED', 'true')
      vi.stubEnv('PAL_API_URL', 'https://pal.example.test')
      vi.stubEnv('PAL_INTEGRATION_SECRET', 'integration-secret-32-characters-long')
      vi.stubEnv('PAL_PSEUDONYM_SECRET', 'pseudonym-secret-32-characters-long')

      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          ok: true,
          created: false,
          entry: {
            id: 'entry-1',
            version: 2,
            text: 'Updated reflection',
            minutes_reported: 30,
            mood: '😊',
          },
        },
        error: null,
      })
      ;(mockSupabaseClient as any).rpc = mockRpc
      ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
        if (table === 'class_days') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: { is_class_day: true },
                error: null,
              }),
            })),
          }
        }
        if (table === 'entries') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'entry-1',
                  version: 1,
                  minutes_reported: 30,
                  mood: '😊',
                },
                error: null,
              }),
            })),
          }
        }
      })

      const response = await POST(new NextRequest(
        'http://localhost:3000/api/student/entries',
        {
          method: 'POST',
          body: JSON.stringify({
            classroom_id: 'classroom-1',
            date: '2024-10-15',
            text: 'Updated reflection',
          }),
        },
      ))

      expect(response.status).toBe(200)
      expect(mockRpc).toHaveBeenCalledWith(
        'upsert_student_entry_with_pal_event_atomic',
        expect.objectContaining({
          p_minutes_reported: 30,
          p_mood: '😊',
          p_pal_event: expect.objectContaining({
            event_type: 'daily_log.completed',
          }),
        }),
      )
    })

    it('should return 500 when updating entry fails', async () => {
      const mockFrom = vi.fn((table: string) => {
        if (table === 'classroom_enrollments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: { id: 'enrollment-1' },
                error: null,
              }),
            })),
          }
        } else if (table === 'class_days') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: { is_class_day: true },
                error: null,
              }),
            })),
          }
        } else if (table === 'entries') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValueOnce({
                data: { id: 'entry-1' },
                error: null,
              }),
            })),
            update: vi.fn(() => ({
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    data: null,
                    error: { message: 'Update failed' },
                  }),
                })),
              })),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/student/entries', {
        method: 'POST',
        body: JSON.stringify({
          classroom_id: 'classroom-1',
          date: '2024-10-15',
          text: 'Updated entry',
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to update entry')
    })
  })
})

describe('PATCH /api/student/entries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('atomically creates the first autosaved log with its Pal fact', async () => {
    vi.stubEnv('PAL_ENABLED', 'true')
    vi.stubEnv('PAL_API_URL', 'https://pal.example.test')
    vi.stubEnv('PAL_INTEGRATION_SECRET', 'integration-secret-32-characters-long')
    vi.stubEnv('PAL_PSEUDONYM_SECRET', 'pseudonym-secret-32-characters-long')

    const content: TiptapContent = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'First autosaved log' }],
      }],
    }
    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        ok: true,
        created: true,
        entry: {
          id: 'entry-1',
          version: 1,
          text: 'First autosaved log',
          rich_content: content,
        },
      },
      error: null,
    })
    ;(mockSupabaseClient as any).rpc = mockRpc
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'class_days') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { is_class_day: true },
              error: null,
            }),
          })),
        }
      }
      if (table === 'entries') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { code: 'PGRST116' },
            }),
          })),
        }
      }
    })

    const response = await PATCH(new NextRequest(
      'http://localhost:3000/api/student/entries',
      {
        method: 'PATCH',
        body: JSON.stringify({
          classroom_id: 'classroom-1',
          date: '2024-10-15',
          version: 1,
          rich_content: content,
        }),
      },
    ))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      entry: { id: 'entry-1' },
      pal_delivery: 'delivered',
    })
    expect(mockRpc).toHaveBeenCalledWith(
      'upsert_student_entry_with_pal_event_atomic',
      expect.objectContaining({
        p_student_id: 'student-1',
        p_classroom_id: 'classroom-1',
        p_date: '2024-10-15',
        p_pal_event: expect.objectContaining({
          event_type: 'daily_log.completed',
          metadata: expect.objectContaining({ activity_day: '2024-10-15' }),
        }),
      }),
    )
    expect(mockAttemptImmediatePalEventDelivery).toHaveBeenCalledWith({
      event: expect.objectContaining({ event_type: 'daily_log.completed' }),
      supabase: mockSupabaseClient,
    })
  })

  it('atomically saves an empty autosave without emitting a completion fact', async () => {
    vi.stubEnv('PAL_ENABLED', 'true')
    vi.stubEnv('PAL_API_URL', 'https://pal.example.test')
    vi.stubEnv('PAL_INTEGRATION_SECRET', 'integration-secret-32-characters-long')
    vi.stubEnv('PAL_PSEUDONYM_SECRET', 'pseudonym-secret-32-characters-long')

    const content: TiptapContent = {
      type: 'doc',
      content: [{ type: 'paragraph' }],
    }
    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        ok: true,
        created: true,
        entry: { id: 'entry-empty', version: 1, text: '', rich_content: content },
      },
      error: null,
    })
    ;(mockSupabaseClient as any).rpc = mockRpc
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'class_days') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { is_class_day: true },
              error: null,
            }),
          })),
        }
      }
      if (table === 'entries') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { code: 'PGRST116' },
            }),
          })),
        }
      }
    })

    const response = await PATCH(new NextRequest(
      'http://localhost:3000/api/student/entries',
      {
        method: 'PATCH',
        body: JSON.stringify({
          classroom_id: 'classroom-1',
          date: '2024-10-15',
          version: 1,
          rich_content: content,
        }),
      },
    ))

    expect(response.status).toBe(200)
    expect(mockRpc).toHaveBeenCalledWith(
      'upsert_student_entry_with_pal_event_atomic',
      expect.objectContaining({
        p_pal_event: null,
      }),
    )
    expect(mockRpc.mock.calls[0][1]).not.toHaveProperty('p_expected_version')
  })

  it('atomically emits the fact when an existing empty autosave gains content', async () => {
    vi.stubEnv('PAL_ENABLED', 'true')
    vi.stubEnv('PAL_API_URL', 'https://pal.example.test')
    vi.stubEnv('PAL_INTEGRATION_SECRET', 'integration-secret-32-characters-long')
    vi.stubEnv('PAL_PSEUDONYM_SECRET', 'pseudonym-secret-32-characters-long')

    const emptyContent: TiptapContent = {
      type: 'doc',
      content: [{ type: 'paragraph' }],
    }
    const nextContent: TiptapContent = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'Now this qualifies' }],
      }],
    }
    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        ok: true,
        created: false,
        entry: {
          id: 'entry-1',
          version: 2,
          text: 'Now this qualifies',
          rich_content: nextContent,
        },
      },
      error: null,
    })
    ;(mockSupabaseClient as any).rpc = mockRpc
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'class_days') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { is_class_day: true },
              error: null,
            }),
          })),
        }
      }
      if (table === 'entries') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'entry-1',
                version: 1,
                text: '',
                rich_content: emptyContent,
                minutes_reported: 45,
                mood: '🙂',
              },
              error: null,
            }),
          })),
        }
      }
    })

    const response = await PATCH(new NextRequest(
      'http://localhost:3000/api/student/entries',
      {
        method: 'PATCH',
        body: JSON.stringify({
          classroom_id: 'classroom-1',
          date: '2024-10-15',
          version: 1,
          rich_content: nextContent,
        }),
      },
    ))

    expect(response.status).toBe(200)
    expect(mockRpc).toHaveBeenCalledWith(
      'upsert_student_entry_with_pal_event_atomic',
      expect.objectContaining({
        p_expected_version: 1,
        p_minutes_reported: 45,
        p_mood: '🙂',
        p_pal_event: expect.objectContaining({
          event_type: 'daily_log.completed',
        }),
      }),
    )
  })

  it('should apply patch and increment version', async () => {
    const baseContent: TiptapContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
    }
    const nextContent: TiptapContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] }],
    }
    const patch = createJsonPatch(baseContent, nextContent)

    const mockUpdate = vi.fn(() => ({
      eq: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'entry-1',
              version: 3,
              text: 'Hello world',
              rich_content: nextContent,
              on_time: true,
            },
            error: null,
          }),
        })),
      })),
    }))

    const mockFrom = vi.fn((table: string) => {
      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: 'enrollment-1' },
              error: null,
            }),
          })),
        }
      } else if (table === 'class_days') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { is_class_day: true },
              error: null,
            }),
          })),
        }
      } else if (table === 'entries') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'entry-1',
                version: 2,
                text: 'Hello',
                rich_content: baseContent,
              },
              error: null,
            }),
          })),
          update: mockUpdate,
        }
      }
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/student/entries', {
      method: 'PATCH',
      body: JSON.stringify({
        classroom_id: 'classroom-1',
        date: '2024-10-15',
        version: 2,
        patch,
      }),
    })

    const response = await PATCH(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.entry.version).toBe(3)
    expect(mockUpdate).toHaveBeenCalledWith({
      text: 'Hello world',
      rich_content: nextContent,
      on_time: expect.any(Boolean),
      version: 3,
    })
  })

  it('should return 409 when version does not match', async () => {
    const mockFrom = vi.fn((table: string) => {
      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: 'enrollment-1' },
              error: null,
            }),
          })),
        }
      } else if (table === 'class_days') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { is_class_day: true },
              error: null,
            }),
          })),
        }
      } else if (table === 'entries') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'entry-1',
                version: 3,
                text: 'Server entry',
                rich_content: {
                  type: 'doc',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Server entry' }] }],
                },
              },
              error: null,
            }),
          })),
        }
      }
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/student/entries', {
      method: 'PATCH',
      body: JSON.stringify({
        classroom_id: 'classroom-1',
        date: '2024-10-15',
        version: 2,
        rich_content: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Local entry' }] }],
        },
      }),
    })

    const response = await PATCH(request)
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.error).toBe('Entry has been updated elsewhere')
  })
})
