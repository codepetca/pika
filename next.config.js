const { execSync } = require('child_process')

const NO_REFERRER_ROUTES = [
  '/api/storage/submission-images',
  '/api/student/tests/:id/documents/:docId/:delivery(file|snapshot)',
  '/api/teacher/tests/:id/documents/:docId/:delivery(file|snapshot)',
  '/api/student/attendance/:path*',
  '/api/teacher/attendance/:path*',
  '/api/integrations/attendance/:path*',
  '/api/cron/bara-attendance-smoke',
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
      ...NO_REFERRER_ROUTES.map((source) => ({
        source,
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      })),
    ]
  },
}

module.exports = nextConfig
