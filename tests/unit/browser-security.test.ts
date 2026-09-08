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

  it('allows only the configured WorkOS origin when its browser logout is enabled', () => {
    const defaultWorkOSPolicy = createContentSecurityPolicy('nonce', {
      isDevelopment: false,
      workosEnabled: true,
    })
    const customWorkOSPolicy = createContentSecurityPolicy('nonce', {
      isDevelopment: false,
      workosEnabled: true,
      workosApiHostname: 'auth.example.test',
      workosApiPort: '8443',
    })
    const disabledPolicy = createContentSecurityPolicy('nonce', {
      isDevelopment: false,
      workosEnabled: false,
      workosApiHostname: 'auth.example.test',
    })

    expect(defaultWorkOSPolicy).toContain("form-action 'self' https://api.workos.com")
    expect(customWorkOSPolicy).toContain("form-action 'self' https://auth.example.test:8443")
    expect(disabledPolicy).toContain("form-action 'self'")
    expect(disabledPolicy).not.toContain('auth.example.test')
  })

  it('allows only validated configured origins for browser integrations', () => {
    const policy = createContentSecurityPolicy('nonce', {
      isDevelopment: false,
      supabaseUrl: 'https://project.supabase.co/storage/v1',
      palEnabled: true,
      palApiUrl: 'https://pal.example.test',
    })

    expect(policy).toContain(
      "connect-src 'self' https://project.supabase.co https://pal.example.test",
    )
    expect(policy).not.toContain('/storage/v1')
  })

  it('does not allow the configured Pal origin while the integration is disabled', () => {
    const policy = createContentSecurityPolicy('nonce', {
      isDevelopment: false,
      palEnabled: false,
      palApiUrl: 'https://pal.example.test',
    })

    expect(policy).toContain("connect-src 'self';")
    expect(policy).not.toContain('pal.example.test')
  })

  it('rejects unsafe configured origins and limits development exceptions', () => {
    const productionPolicy = createContentSecurityPolicy('nonce', {
      isDevelopment: false,
      supabaseUrl: 'http://project.supabase.co',
      palApiUrl: 'https://user:password@pal.example.test',
    })
    const developmentPolicy = createContentSecurityPolicy('nonce', {
      isDevelopment: true,
      palEnabled: true,
      palApiUrl: 'http://127.0.0.1:3210',
      workosEnabled: true,
      workosApiHostname: 'localhost',
      workosApiHttps: 'false',
      workosApiPort: '8000',
    })

    expect(productionPolicy).toContain("connect-src 'self';")
    expect(productionPolicy).not.toContain('project.supabase.co')
    expect(productionPolicy).not.toContain('pal.example.test')
    expect(developmentPolicy).toContain("connect-src 'self' http://127.0.0.1:3210 ws:")
    expect(developmentPolicy).toContain("'unsafe-eval'")
    expect(developmentPolicy).toContain("frame-src 'self' https: http:")
    expect(developmentPolicy).toContain("form-action 'self' http://localhost:8000")
  })
})
