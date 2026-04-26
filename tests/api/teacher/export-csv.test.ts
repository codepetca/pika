/**
 * API tests for GET /api/teacher/export-csv
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '@/app/api/teacher/export-csv/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher-1' })) }))
vi.mock('@/lib/attendance', () => ({ computeAttendanceRecords: vi.fn(() => []) }))
vi.mock('@/lib/timezone', () => ({ getTodayInToronto: vi.fn(() => '2026-04-25') }))

const mockSupabaseClient = { from: vi.fn() }

describe('GET /api/teacher/export-csv', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabaseClient.from = vi.fn()
  })

  it('should return 400 when classroom_id is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/export-csv')
    const response = await GET(request)
    expect(response.status).toBe(400)
  })

  it('should return 403 when teacher does not own classroom', async () => {
    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: { teacher_id: 'other' }, error: null }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/teacher/export-csv?classroom_id=c1')
    const response = await GET(request)
    expect(response.status).toBe(403)
  })

  it('returns a CSV export with class-day columns and attendance symbols', async () => {
    const { computeAttendanceRecords } = await import('@/lib/attendance')
    ;(computeAttendanceRecords as any).mockReturnValueOnce([
      {
        student_id: 'student-2',
        student_email: 'b@example.com',
        summary: { present: 1, absent: 1 },
        dates: {
          '2026-04-20': 'present',
          '2026-04-21': 'absent',
        },
      },
      {
        student_id: 'student-1',
        student_email: 'a@example.com',
        summary: { present: 2, absent: 0 },
        dates: {
          '2026-04-20': 'present',
          '2026-04-21': 'present',
        },
      },
    ])

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'classrooms') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { teacher_id: 'teacher-1', title: 'Period 1' },
                error: null,
              }),
            })),
          })),
        }
      }

      if (table === 'class_days') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn().mockResolvedValue({
                data: [
                  { date: '2026-04-20', is_class_day: true },
                  { date: '2026-04-21', is_class_day: true },
                  { date: '2026-04-22', is_class_day: false },
                ],
                error: null,
              }),
            })),
          })),
        }
      }

      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({
              data: [
                { student_id: 'student-2', users: { id: 'student-2', email: 'b@example.com' } },
                { student_id: 'student-1', users: { id: 'student-1', email: 'a@example.com' } },
              ],
              error: null,
            }),
          })),
        }
      }

      if (table === 'student_profiles') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({
              data: [
                { user_id: 'student-1', first_name: 'Ada', last_name: 'Lovelace' },
                { user_id: 'student-2', first_name: 'Grace', last_name: 'Hopper' },
              ],
              error: null,
            }),
          })),
        }
      }

      if (table === 'entries') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: [{ id: 'entry-1' }], error: null }),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/export-csv?classroom_id=c1')
    const response = await GET(request)
    const csv = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/csv')
    expect(response.headers.get('Content-Disposition')).toMatch(/^attachment; filename="attendance-Period-1-/)
    expect(csv).toBe([
      'Student Email,Present,Absent,2026-04-20,2026-04-21',
      'b@example.com,1,1,P,A',
      'a@example.com,2,0,P,P',
      '',
    ].join('\n'))
    expect(computeAttendanceRecords).toHaveBeenCalledWith(
      [
        { id: 'student-1', email: 'a@example.com', first_name: 'Ada', last_name: 'Lovelace' },
        { id: 'student-2', email: 'b@example.com', first_name: 'Grace', last_name: 'Hopper' },
      ],
      [
        { date: '2026-04-20', is_class_day: true },
        { date: '2026-04-21', is_class_day: true },
        { date: '2026-04-22', is_class_day: false },
      ],
      [{ id: 'entry-1' }],
      '2026-04-25',
    )
  })
})
