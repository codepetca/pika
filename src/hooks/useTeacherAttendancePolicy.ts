'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  formatTeacherAttendancePolicyHours,
  invalidateTeacherAttendancePolicy,
  readTeacherAttendancePolicy,
  type TeacherAttendancePolicy,
} from '@/lib/teacher-attendance-policy'

type PolicyState = {
  owner: string
  state: 'loading' | 'ready' | 'error'
  policy: TeacherAttendancePolicy | null
  error: string | null
}

export function useTeacherAttendancePolicy(classroomId: string, enabled: boolean) {
  const owner = `${classroomId}:${enabled}`
  const ownerRef = useRef(owner)
  const generation = useRef(0)
  const mounted = useRef(true)
  if (ownerRef.current !== owner) {
    ownerRef.current = owner
    generation.current += 1
  }
  const [snapshot, setSnapshot] = useState<PolicyState | null>(null)

  const load = useCallback(async () => {
    if (!enabled) return
    const request = ++generation.current
    const current = () => mounted.current && ownerRef.current === owner && generation.current === request
    setSnapshot((previous) => ({
      owner, state: 'loading', policy: previous?.owner === owner ? previous.policy : null, error: null,
    }))
    try {
      const policy = await readTeacherAttendancePolicy(classroomId)
      if (current()) setSnapshot({ owner, state: 'ready', policy, error: null })
    } catch (error) {
      if (current()) setSnapshot((previous) => ({
        owner, state: 'error', policy: previous?.owner === owner ? previous.policy : null,
        error: error instanceof Error ? error.message : 'Attendance settings are temporarily unavailable',
      }))
    }
  }, [classroomId, enabled, owner])

  useEffect(() => {
    mounted.current = true
    void load()
    return () => {
      mounted.current = false
      generation.current += 1
    }
  }, [load])

  const refresh = useCallback(async () => {
    invalidateTeacherAttendancePolicy(classroomId)
    await load()
  }, [classroomId, load])

  const acceptSaved = useCallback((policy: TeacherAttendancePolicy) => {
    if (!mounted.current || ownerRef.current !== owner || policy.classroomId !== classroomId) return
    generation.current += 1
    invalidateTeacherAttendancePolicy(classroomId)
    setSnapshot({ owner, state: 'ready', policy, error: null })
  }, [classroomId, owner])

  const current = enabled && snapshot?.owner === owner ? snapshot : null
  const policy = current?.policy ?? null
  return {
    state: enabled ? current?.state ?? 'loading' : 'disabled',
    policy,
    error: current?.error ?? null,
    label: policy ? formatTeacherAttendancePolicyHours(policy) : null,
    refresh,
    acceptSaved,
  }
}
