import { describe, expect, it } from 'vitest'
import { createContentSecurityPolicy } from '@/lib/browser-security'

describe('browser security policy', () => {
  it('uses a nonce for scripts and denies high-risk defaults', () => {
    const policy = createContentSecurityPolicy('testnonce', {
      isDevelopment: false,
    })

    expect(policy).toContain("script-src 'self' 'nonce-testnonce' 'strict-dynamic'")
    expect(policy).toContain("script-src-attr 'none'")
    expect(policy).not.toContain("'unsafe-eval'")
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'")
    expect(policy).toContain("object-src 'none'")
    expect(policy).toContain("base-uri 'self'")
    expect(policy).toContain("form-action 'self'")
    expect(policy).toContain("frame-ancestors 'self'")
  })

  it('allows only validated configured origins for browser integrations', () => {
    const policy = createContentSecurityPolicy('nonce', {
      isDevelopment: false,
      supabaseUrl: 'https://project.supabase.co/storage/v1',
      palApiUrl: 'https://pal.example.test',
    })

    expect(policy).toContain(
      "connect-src 'self' https://project.supabase.co https://pal.example.test",
    )
    expect(policy).not.toContain('/storage/v1')
  })

  it('rejects unsafe configured origins and limits development exceptions', () => {
    const productionPolicy = createContentSecurityPolicy('nonce', {
      isDevelopment: false,
      supabaseUrl: 'http://project.supabase.co',
      palApiUrl: 'https://user:password@pal.example.test',
    })
    const developmentPolicy = createContentSecurityPolicy('nonce', {
      isDevelopment: true,
      palApiUrl: 'http://127.0.0.1:3210',
    })

    expect(productionPolicy).toContain("connect-src 'self';")
    expect(productionPolicy).not.toContain('project.supabase.co')
    expect(productionPolicy).not.toContain('pal.example.test')
    expect(developmentPolicy).toContain("connect-src 'self' http://127.0.0.1:3210 ws:")
    expect(developmentPolicy).toContain("'unsafe-eval'")
    expect(developmentPolicy).toContain("frame-src 'self' https: http:")
  })
})
