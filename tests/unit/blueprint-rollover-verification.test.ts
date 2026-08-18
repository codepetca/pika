import { describe, expect, it } from 'vitest'
import { isLoopbackUrl } from '../../e2e/verify/blueprint-rollover'

describe('Blueprint rollover verification safety', () => {
  it.each([
    'http://localhost:3000',
    'http://127.0.0.1:54321',
    'postgresql://postgres:postgres@[::1]:54322/postgres',
  ])('allows loopback targets: %s', (url) => {
    expect(isLoopbackUrl(url)).toBe(true)
  })

  it.each([
    'https://pika.example.com',
    'https://project.supabase.co',
    'postgresql://postgres:secret@db.example.com/postgres',
    'not-a-url',
  ])('rejects non-local targets: %s', (url) => {
    expect(isLoopbackUrl(url)).toBe(false)
  })
})
