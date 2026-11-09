const { execSync } = require('child_process')

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: process.env.PIKA_E2E_FIXTURES === 'true' ? false : undefined,
  webpack(config, { isServer }) {
    // pdfnative also exports a Node-only stream-to-file helper. The browser
    // report generator never calls it, but webpack still resolves its import.
    if (!isServer) config.resolve.fallback = { ...config.resolve.fallback, fs: false }
    return config
  },
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
          { key: 'Referrer-Policy', value: 'no-referrer' },
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
    ]
  },
}

module.exports = nextConfig
