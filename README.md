# Pika - Student Daily Log & Attendance Tracking

A Next.js application for tracking student daily journal entries and attendance for online high school courses.

## Features

### For Students
- Passwordless email authentication (one-time codes)
- Daily journal entry submission with deadline tracking (midnight Toronto time)
- Attendance history with visual indicators (🟢 present, 🟡 late, 🔴 absent)
- Mood tracking with emoji selection

### For Teachers
- Attendance dashboard with matrix view (students × dates)
- View individual student entries
- Class days calendar management
- CSV export for attendance records
- Multi-course support

## Tech Stack

- **Framework**: Next.js 14 (App Router, TypeScript)
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Custom passwordless email codes (hashed with bcrypt)
- **Styling**: Tailwind CSS
- **Testing**: Vitest + React Testing Library
- **Session Management**: iron-session (HTTP-only cookies)

## Prerequisites

- Node.js 18+ and npm
- Supabase account and project
- Git

## Getting Started

### 1. Clone the repository

```bash
git clone <repository-url>
cd pika
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to Project Settings → API to get your:
   - Project URL (`NEXT_PUBLIC_SUPABASE_URL`)
   - Publishable key (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) - starts with `sb_publishable_`
   - Secret key (`SUPABASE_SECRET_KEY`) - starts with `sb_secret_`

**Note**: Newer Supabase projects use publishable/secret keys instead of the legacy anon/service_role keys. Both work, but the new format is recommended.

### 4. Apply database migrations

Run each migration file in the `supabase/migrations/` directory in order:

1. In Supabase dashboard, go to SQL Editor
2. Create a new query
3. Copy and paste the contents of each migration file:
   - `001_create_users.sql`
   - `002_create_login_codes.sql`
   - `003_create_class_days.sql`
   - `004_create_entries.sql`
4. Run each query

Alternatively, if using Supabase CLI:

```bash
supabase db push
```

### 5. Generate SESSION_SECRET

Generate a secure random secret for encrypting session cookies:

```bash
npm run generate:secret
```

This generates a 64-character hex string (only 0-9 and a-f, no special characters).

**Example output:**
```
✅ Generated SESSION_SECRET:

a3f8d2e1c4b6a9f7e3d5c8b2a1f9e6d4c7b3a8f5e2d9c6b4a7f3e1d8c5b2a9f6

📝 Add this to your .env.local file:

SESSION_SECRET=a3f8d2e1c4b6a9f7e3d5c8b2a1f9e6d4c7b3a8f5e2d9c6b4a7f3e1d8c5b2a9f6
```

Copy the generated secret for the next step.

### 6. Configure environment variables

Create a `.env.local` file in the root directory:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your-key-here
SUPABASE_SECRET_KEY=sb_secret_your-key-here

# Session (use the generated secret from previous step)
SESSION_SECRET=paste-your-generated-hex-secret-here

# Auth Configuration
# Comma-separated list of teacher emails for development
DEV_TEACHER_EMAILS=teacher@example.com,admin@yrdsb.ca

# Email (Console logging for development)
ENABLE_MOCK_EMAIL=true

# Application
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

**Alternative methods to generate SESSION_SECRET:**
```bash
# Hex format (recommended - no special characters)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Base64 format (includes +, /, = characters)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Using OpenSSL (Mac/Linux) - hex format
openssl rand -hex 32
```

### 7. Seed the database (optional)

Load test data for development:

```bash
npm run seed
```

This creates:
- 1 teacher account (`teacher@yrdsb.ca`)
- 3 student accounts with varied attendance patterns
- Class days for GLD2O Semester 1 2024
- Sample journal entries

### 8. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Development

### Running tests

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# UI mode
npm run test:ui
```

### Building for production

```bash
npm run build
npm start
```

## Authentication Flow

1. User enters email on `/login`
2. System generates an 8-character code, hashes it with bcrypt, and stores in database
3. Code is logged to console (or emailed in production)
4. User enters code on `/verify-code`
5. System validates code, creates/fetches user record
6. Role is assigned based on email domain:
   - Emails ending with `@gapps.yrdsb.ca` or `@yrdsb.ca` → teacher
   - Emails in `DEV_TEACHER_EMAILS` → teacher
   - All others → student
7. Session is created with HTTP-only cookie
8. User is redirected to appropriate dashboard

## Role Determination

Teachers are identified by:
- Email domains: `@gapps.yrdsb.ca` or `@yrdsb.ca`
- Development teacher list in `DEV_TEACHER_EMAILS` environment variable

All other email addresses are assigned the student role.

## Attendance Logic

Attendance is calculated per student per class day:

- **Present** (🟢): Entry submitted before midnight (Toronto time)
- **Late** (🟡): Entry submitted after midnight
- **Absent** (🔴): No entry submitted

All times are handled in **America/Toronto** timezone to ensure consistent deadline enforcement. The daily log form switches to the next day at midnight Toronto time.

## Class Days Management

Teachers can:
1. Generate class days for a semester (automatically excludes weekends and Ontario holidays)
2. Toggle individual days on/off via calendar UI
3. View and manage class days per course

Class days are only generated once per course. After generation, teachers can adjust individual days as needed.

## Project Structure

```
pika/
├── src/
│   ├── app/                    # Next.js App Router pages
│   │   ├── api/               # API routes
│   │   ├── student/           # Student-facing pages
│   │   ├── teacher/           # Teacher-facing pages
│   │   ├── login/
│   │   ├── verify-code/
│   │   └── logout/
│   ├── components/            # Reusable React components
│   ├── lib/                   # Core utilities and business logic
│   │   ├── supabase.ts       # Supabase client
│   │   ├── auth.ts           # Session management
│   │   ├── attendance.ts     # Attendance calculation
│   │   ├── crypto.ts         # Code generation/hashing
│   │   ├── timezone.ts       # Timezone utilities
│   │   └── calendar.ts       # Class days generation
│   └── types/                # TypeScript type definitions
├── supabase/migrations/      # Database migrations
├── tests/                    # Test files
└── scripts/                  # Utility scripts
```

## Deployment to Vercel

1. Push your code to GitHub
2. Import project in Vercel dashboard
3. Configure environment variables (same as `.env.local`)
4. Set `ENABLE_MOCK_EMAIL=false` and configure real SMTP for production emails
5. Deploy

Vercel will automatically detect Next.js and configure build settings.

## Environment Variables Reference

| Variable | Description | Example |
|----------|-------------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | `https://xxx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key (safe for client-side) | `sb_publishable_...` |
| `SUPABASE_SECRET_KEY` | Supabase secret key (server-side only, elevated access) | `sb_secret_...` |
| `SESSION_SECRET` | Secret for encrypting sessions (32+ chars) | Random string |
| `DEV_TEACHER_EMAILS` | Comma-separated teacher emails for dev | `teacher@test.com` |
| `ENABLE_MOCK_EMAIL` | Console log codes instead of emailing | `true` or `false` |
| `NEXT_PUBLIC_APP_URL` | Application base URL | `http://localhost:3000` |

**Note**: If you have an older Supabase project, you can still use `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`, but the new publishable/secret key format is recommended.

## Security Considerations

- Login codes are hashed with bcrypt before storage
- Sessions use HTTP-only, secure cookies
- Rate limiting on code requests (5 per hour per email)
- Max 3 verification attempts per code
- Codes expire after 10 minutes
- All routes enforce role-based access control

## Known Limitations

- Currently hardcoded to Ontario holidays for 2024-2025
- Email sending mocked in development (console logging)
- Single course (GLD2O) prioritized in UI, though multi-course supported in backend

## Future Enhancements

- Teacher interface for setting daily prompts
- Student notifications for missing entries
- Analytics and reporting
- Multi-semester support in UI
- Actual email delivery integration (Resend, SendGrid, etc.)
- Configurable holidays per region

## License

[Your License Here]

## Support

For issues or questions, please open an issue on GitHub.
