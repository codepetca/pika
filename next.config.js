const { execSync } = require('child_process')

const NO_REFERRER_MATCHES = [
  { source: '/api/storage/submission-images' },
  { source: '/api/student/tests/:id/documents/:docId/:delivery(file|snapshot)' },
  { source: '/api/teacher/tests/:id/documents/:docId/:delivery(file|snapshot)' },
  { source: '/api/student/attendance/:path*' },
  { source: '/api/teacher/attendance/:path*' },
  { source: '/api/integrations/attendance/:path*' },
  { source: '/api/cron/bara-attendance-smoke' },
  { source: '/attendance/check-in/:token' },
  { source: '/attendance/classroom/:token' },
  {
    source: '/login',
    has: [
      {
        type: 'query',
        key: 'next',
        value: '/attendance/(?:check-in|classroom)/.+',
      },
    ],
  },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: process.env.PIKA_E2E_FIXTURES === 'true' ? false : undefined,
  env: {
    NEXT_PUBLIC_APP_VERSION: require('./package.json').version,
    NEXT_PUBLIC_GIT_COMMIT: process.env.VERCEL_GIT_COMMIT_SHA
      || (() => { try { return execSync('git rev-parse HEAD').toString().trim() } catch { return 'unknown' } })(),
    NEXT_PUBLIC_VERCEL_ENV: process.env.VERCEL_ENV || 'development',
  },
  transpilePackages: [
    '@tiptap/core',
    '@tiptap/react',
    '@tiptap/starter-kit',
    '@tiptap/extension-link',
    '@tiptap/extension-placeholder',
  ],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          {
            key: 'Permissions-Policy',
            value: [
              'accelerometer=()',
              'browsing-topics=()',
              'camera=()',
              'display-capture=()',
              'encrypted-media=()',
              'fullscreen=(self)',
              'geolocation=()',
              'gyroscope=()',
              'magnetometer=()',
              'microphone=()',
              'payment=()',
              'usb=()',
            ].join(', '),
          },
        ],
      },
      ...NO_REFERRER_MATCHES.map((match) => ({
        ...match,
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      })),
    ]
  },
}

module.exports = nextConfig
