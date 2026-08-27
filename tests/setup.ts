import '@testing-library/jest-dom'

// Keep test output signal high by default. Set VITEST_SHOW_CONSOLE=true to see logs.
if (process.env.VITEST_SHOW_CONSOLE !== 'true') {
  console.error = (() => {}) as typeof console.error
  console.warn = (() => {}) as typeof console.warn
}

// Mock window.matchMedia for responsive hooks used by tiptap UI components.
// Guarded because the `node` project runs DOM-free suites without a window.
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

// Mock environment variables for testing
process.env.SESSION_SECRET = 'a3f8d2e1c4b6a9f7e3d5c8b2a1f9e6d4c7b3a8f5e2d9c6b4a7f3e1d8c5b2a9f6' // 64 hex chars
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test-key'
process.env.SUPABASE_SECRET_KEY = 'sb_secret_test-key'
process.env.ENABLE_MOCK_EMAIL = 'true'
// The test suite keeps legacy password fixtures available explicitly. Product
// runtime defaults to WorkOS Magic Auth when this override is absent.
process.env.PIKA_LEGACY_PASSWORD_AUTH = 'true'
process.env.WORKOS_CLIENT_ID = 'client_test'
process.env.WORKOS_API_KEY = 'sk_test_auth'
process.env.WORKOS_COOKIE_PASSWORD = 'test-workos-cookie-password-32-characters'

// JSDOM doesn't fully implement Range#getClientRects/getBoundingClientRect, but TipTap/ProseMirror uses them.
if (typeof document !== 'undefined' && typeof Range !== 'undefined') {
  const el = document.createElement('div')
  const rangeProto = Range.prototype as any

  if (typeof rangeProto.getClientRects !== 'function') {
    rangeProto.getClientRects = () => el.getClientRects()
  }

  if (typeof rangeProto.getBoundingClientRect !== 'function') {
    rangeProto.getBoundingClientRect = () => el.getBoundingClientRect()
  }
}
