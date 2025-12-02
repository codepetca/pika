# Project Context

This document provides an overview of the **Pika** project, including its purpose, tech stack, development setup, and deployment strategy.

---

## What is Pika?

**Pika** is a student daily log and attendance tracking application for an online high school course (GLD2O). Students submit daily journal entries before midnight (America/Toronto timezone), and teachers monitor attendance and read student submissions through a dashboard.

**Status**: Basic MVP complete - authentication, student experience, and teacher dashboard implemented. Currently working on comprehensive test coverage and polish.

---

## Project Goals

### Primary Goals
1. **Simple, reliable attendance tracking** — Students submit entries, system determines present/absent
2. **Daily journal submission workflow** — Mobile-friendly interface for students to write and submit
3. **Assignment management** — Teachers create assignments, students edit in online editor
4. **Teacher dashboard** — Monitor attendance, read submissions, export data

### Non-Goals
- Complex LMS features (gradebook, announcements, forums)
- Multi-course support (built specifically for GLD2O)
- Real-time collaboration
- Mobile apps (web-first with responsive design)

---

## Target Users

### Students
- **Context**: Online high school students in GLD2O course
- **Need**: Simple way to submit daily logs from any device
- **Key workflow**: Login → Write entry → Submit → View submission history
- **Device**: Primarily mobile devices

### Teachers
- **Context**: Instructors monitoring daily student engagement
- **Need**: Dashboard to track attendance and read student submissions
- **Key workflow**: Login → View attendance matrix → Read entries → Export data
- **Device**: Desktop/laptop computers

---

## Tech Stack

### Framework & Language
- **Next.js 14+** — React framework with App Router
- **TypeScript** — Type-safe JavaScript
- **React 18+** — UI library

### Database & Backend
- **Supabase** — PostgreSQL database with real-time capabilities
- **Supabase Auth** — Session management (custom email code flow)
- **Row Level Security (RLS)** — Database-level authorization

### Styling & UI
- **Tailwind CSS** — Utility-first CSS framework
- **No component libraries** — Custom components only

### Testing
- **Vitest** — Fast unit test runner
- **React Testing Library** — Component testing utilities
- **Testing philosophy**: TDD-first for core logic, minimal UI tests

### Development Tools
- **ESLint** — Code linting
- **TypeScript** — Type checking
- **Git** — Version control
- **GitHub** — Repository hosting and CI/CD

### Deployment
- **Vercel** — Next.js hosting
- **Supabase Cloud** — Production database

---

## Getting Started

### Prerequisites
- **Node.js 18+** — JavaScript runtime
- **npm or pnpm** — Package manager
- **Supabase account** — Database (or local instance)
- **SMTP credentials** — Email sending (or use mock mode)
- **Git** — Version control

### Local Development Setup

#### 1. Clone Repository
```bash
git clone <repository-url>
cd pika
```

#### 2. Install Dependencies
```bash
npm install
```

#### 3. Set Up Environment Variables

Create `.env.local` file in project root:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...

# Email (for sending codes)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_FROM=your-email@gmail.com

# Auth
DEV_TEACHER_EMAILS=teacher@example.com,another@example.com
SESSION_SECRET=your-random-secret-min-32-chars
SESSION_MAX_AGE=604800

# Dev flags
ENABLE_MOCK_EMAIL=true
```

**Note**: Supabase now uses publishable/secret keys (starting with `sb_publishable_` and `sb_secret_`) instead of legacy anon/service_role keys. The code supports both formats.

#### 4. Run Migrations

If using Supabase locally:
```bash
supabase start
supabase db reset
```

If using Supabase Cloud, migrations run automatically on push.

#### 5. Start Development Server
```bash
npm run dev
```

Open http://localhost:3000

---

## Development Commands

### Running the Application
```bash
npm run dev              # Start dev server on localhost:3000
npm run build            # Production build
npm start                # Run production build locally
```

### Testing
```bash
npm run test             # Run all tests once
npm run test:watch       # Watch mode (for TDD)
npm run test:ui          # Vitest UI (visual test runner)
npm run test:coverage    # Generate coverage report
```

### Database (Local Supabase)
```bash
supabase start           # Start local Supabase instance
supabase stop            # Stop local instance
supabase db reset        # Reset and re-run migrations
supabase migration new <name>  # Create new migration
supabase migration up    # Apply migrations
```

### Code Quality
```bash
npm run lint             # Run ESLint
npm run type-check       # TypeScript type checking
```

---

## Environment Variables

### Required Variables

#### Supabase Configuration
- `NEXT_PUBLIC_SUPABASE_URL` — Your Supabase project URL
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — Publishable key (starts with `sb_publishable_`)
- `SUPABASE_SECRET_KEY` — Secret key (starts with `sb_secret_`)

**Legacy keys** (still supported):
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Legacy anon key
- `SUPABASE_SERVICE_ROLE_KEY` — Legacy service role key

#### Email Configuration
- `SMTP_HOST` — SMTP server hostname (e.g., smtp.gmail.com)
- `SMTP_PORT` — SMTP port (usually 587 for TLS)
- `SMTP_USER` — SMTP username
- `SMTP_PASSWORD` — SMTP password (use app-specific password for Gmail)
- `SMTP_FROM` — From email address

#### Authentication
- `DEV_TEACHER_EMAILS` — Comma-separated list of teacher emails for development
- `SESSION_SECRET` — Random string (min 32 characters) for session encryption
- `SESSION_MAX_AGE` — Session duration in seconds (default: 604800 = 7 days)

#### Development Flags
- `ENABLE_MOCK_EMAIL` — Set to `true` to log email codes instead of sending (development only)

### Optional Variables
- `ALLOWED_EMAIL_DOMAIN` — Restrict signups to specific domain (e.g., `example.com`)
- `NODE_ENV` — Set by Next.js automatically (`development` | `production` | `test`)

---

## Key Features Overview

### 1. Authentication (Passwordless Email Codes)
- User enters email
- System generates 6-digit code, hashes it, stores in DB with 10min expiry
- User receives code via email
- User enters code to verify
- System creates session with HTTP-only cookie
- Rate limiting prevents abuse

### 2. Student Daily Journal
- Students submit text entries daily
- Deadline: Midnight (America/Toronto time)
- Entry marked as "on time" if submitted before midnight
- Students can view submission history
- Students can edit entries until midnight

### 3. Teacher Dashboard
- View attendance matrix (students × dates)
- See icons: 🟢 present, 🔴 absent
- Click student/date cell to read entry
- Export attendance data as CSV
- Filter by date range

### 4. Assignment System (In Progress)
- Teachers create assignments with deadlines
- Students write submissions in online editor
- Auto-save functionality
- Submit/unsubmit before deadline
- Teachers read and provide feedback

---

## Deployment

### Vercel (Recommended)

#### Initial Setup
1. Connect GitHub repository to Vercel
2. Configure environment variables in Vercel dashboard
3. Deploy automatically on push to main branch

#### Environment Variables in Vercel
- Set all production environment variables in Vercel dashboard
- Use Supabase Cloud credentials (not local)
- Set ENABLE_MOCK_EMAIL=false for production

#### Build Settings
- **Framework Preset**: Next.js
- **Build Command**: `npm run build`
- **Output Directory**: `.next`
- **Install Command**: `npm install`

### Supabase (Database)

#### Production Setup
1. Create Supabase project
2. Configure database settings
3. Run migrations automatically via Supabase CLI or dashboard
4. Set up Row Level Security (RLS) policies

#### Connection
- Use Supabase Cloud URL and keys in production
- Enable connection pooling for serverless functions
- Monitor query performance in Supabase dashboard

---

## Architecture at a Glance

```
┌─────────────┐
│   Vercel    │ ← Next.js 14 App (TypeScript)
│  (Frontend) │
└──────┬──────┘
       │
       ├─ Student UI (mobile-first)
       ├─ Teacher UI (desktop)
       └─ API Routes (/api/*)
              │
              ↓
       ┌──────────────┐
       │   Supabase   │ ← PostgreSQL + Auth
       │  (Backend)   │
       └──────────────┘
              │
              ├─ students table
              ├─ teachers table
              ├─ entries table
              ├─ class_days table
              ├─ assignments table
              └─ login_codes table
```

---

## Common Development Tasks

### Add a New Feature
1. Read `/docs/ai-instructions.md` and core docs
2. Write tests FIRST for core logic
3. Implement feature following TDD workflow
4. Add UI components (keep thin)
5. Update documentation if needed

### Fix a Bug
1. Write failing test that reproduces bug
2. Fix code to pass test
3. Verify all tests pass
4. Update docs if bug revealed architecture issue

### Add a Database Table
1. Create new migration: `supabase migration new table_name`
2. Write SQL for table creation + RLS policies
3. Test migration locally: `supabase db reset`
4. Update TypeScript types in `src/types/`
5. Add tests for data access patterns

### Deploy to Production
1. Push code to main branch
2. Vercel deploys automatically
3. Verify deployment in Vercel dashboard
4. Test production site
5. Monitor for errors in Vercel logs

---

## Troubleshooting

### Development Server Won't Start
- Check Node.js version (requires 18+)
- Delete `.next` folder and restart
- Verify `.env.local` file exists and is complete
- Check for port conflicts (port 3000)

### Database Connection Issues
- Verify Supabase credentials in `.env.local`
- Check Supabase project status
- Ensure RLS policies are not blocking queries
- Check database logs in Supabase dashboard

### Tests Failing
- Run `npm run test:coverage` to see what's uncovered
- Check test file imports and mocks
- Verify timezone handling (tests use America/Toronto)
- Clear test cache: `npm run test -- --clearCache`

### Email Codes Not Sending
- Check SMTP credentials
- Verify `ENABLE_MOCK_EMAIL=true` for development
- Check email logs in console when mock enabled
- Test SMTP connection with a simple script

---

## Additional Resources

- **Next.js Docs**: https://nextjs.org/docs
- **Supabase Docs**: https://supabase.com/docs
- **Tailwind CSS**: https://tailwindcss.com/docs
- **Vitest**: https://vitest.dev/guide/

---

## Next Steps

- For architecture details, see [/docs/core/architecture.md](/docs/core/architecture.md)
- For UI/UX guidelines, see [/docs/core/design.md](/docs/core/design.md)
- For testing strategy, see [/docs/core/tests.md](/docs/core/tests.md)
- For roadmap and current status, see [/docs/core/roadmap.md](/docs/core/roadmap.md)
