import '@testing-library/jest-dom'

// Mock window.matchMedia for responsive hooks used by tiptap UI components
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

// Mock environment variables for testing
process.env.SESSION_SECRET = 'a3f8d2e1c4b6a9f7e3d5c8b2a1f9e6d4c7b3a8f5e2d9c6b4a7f3e1d8c5b2a9f6' // 64 hex chars
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test-key'
process.env.SUPABASE_SECRET_KEY = 'sb_secret_test-key'
process.env.ENABLE_MOCK_EMAIL = 'true'

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
