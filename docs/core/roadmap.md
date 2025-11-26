# Implementation Roadmap

Phase-based implementation tracking for **Pika**.

---

## Current Status

✅ **Basic MVP Complete**  
The core attendance tracking system is operational with authentication, student daily logs, and teacher dashboards.

---

## Implementation Phases

### Phase 0 — Setup ✅

- [x] Initialize Next.js with TypeScript
- [x] Configure Tailwind CSS
- [x] Set up Supabase client
- [x] Create environment variables template

### Phase 1 — Auth ✅

- [x] Create database migrations for all tables
- [x] Implement `/api/auth/request-code` with hashing & rate limiting
- [x] Implement `/api/auth/verify-code` with session creation
- [x] Build login and verify-code pages
- [x] Create session utilities and middleware

### Phase 2 — Student Experience ✅

- [x] Build `/student/today` with journal form
- [x] Build `/student/history` with attendance indicators
- [x] Create student API routes for entries
- [x] Implement timezone handling and `on_time` calculation

### Phase 3 — Teacher Dashboard ✅

- [x] Build attendance matrix component
- [x] Implement entry detail modal
- [x] Create CSV export functionality
- [x] Teacher API routes for attendance data

### Phase 4 — Tests & Polish 🔄

- [ ] Write unit tests for core utilities
- [ ] Add component tests
- [ ] Security hardening review
- [ ] Documentation cleanup

---

## Future Features

See [guidance.md](guidance.md) for detailed specifications on upcoming features:

- **Assignments System**: Teachers create assignments with due dates
- **Online Editor**: Students work on assignments in an autosaving editor
- **Submission Workflow**: Submit/unsubmit with late detection
- **Teacher Work Review**: Read-only view of student submissions

These features will be broken into GitHub issues for iterative implementation.

---

## Deployment

**Target**: Vercel

**Steps**:
1. Create Supabase project and apply migrations
2. Configure environment variables in Vercel
3. Connect GitHub repo to Vercel project
4. Deploy automatically on push to main

**Database**: Use Supabase hosted Postgres (not local)  
**Email**: Configure real SMTP for production (mock in development)
