# Pilot MVP Spec (Jan 2026)

This doc captures the current pilot direction and decisions so we can move quickly without losing context.

## Target
- **Pilot size:** 1 teacher, 1 classroom, ~40 students
- **Hard date:** Jan 27, 2026
- **Feature freeze:** Jan 10, 2026
- **Internal dry-run:** Dec 16, 2025

## Environments
- **Staging:** Vercel “staging” environment (used for dry-run and early pilot testing)

## Email (Brevo)
- Use transactional email for signup verification / password reset.
- **From:** `noreply@notify.codepet.ca`
- **Replies:** no-reply
- DNS is managed in Cloudflare (domain registered at Squarespace).

## UX Structure (Teacher)
Teacher primary UI is a single classroom home with tabs:
1. **Attendance**
2. **Logs**
3. **Assignments**
4. **Roster**
5. **Calendar** (class days)
6. **Settings**

Tabs should be context-specific (actions live inside their relevant tab).

## Student Daily “Today” Flow
- Students visit a **Today** page on each school day (driven by the calendar/class days).
- They submit a short daily log (“what they did today”).
- Logs can be edited throughout the day.
- If the student submits **non-empty text at least once**, they count as **present**.
- After the student has submitted for the day, do not allow editing the entry back to empty.

### Daily Log Length
- Enforce a maximum length to keep logs concise.
- Recommended starting limit: **1200 characters** (hard cap; show remaining count).

## Attendance (Present/Absent only)
- No “late” concept in MVP (present/absent only).
- Default teacher view: **today’s attendance**, with date navigation.
- Support:
  - **Day view** (one day at a time)
  - **Month view** (compact grid)
- Cutoff: unsubmitted entries become **absent** after **midnight America/Toronto**.
- Non-class days should appear as **disabled** (not counted).
- Color semantics (for class days):
  - **Green:** present (submitted at least once, non-empty)
  - **Gray:** pending/unsubmitted (before cutoff)
  - **Red:** missing (after cutoff)
- Month view should avoid horizontal scrolling (use compact cell widths).

## Logs (Teacher)
- Default to **today’s logs**, with an easy calendar toggle (today, previous/next, pick a date).
- Show all students:
  - submitted logs displayed normally
  - missing/unsubmitted logs shown in a visually “empty/disabled” style
- For MVP: raw logs only (no summaries yet).

## Roster
- CSV upload is the only supported roster input for MVP.
- CSV columns (4): `Student Number`, `First Name`, `Last Name`, `Email`
- Re-upload behavior: **merge/add only**.
- Enrollment is restricted to **roster emails** (board-issued student emails).
- Teacher can remove a student from the roster at any time:
  - removal immediately removes access to the classroom and disappears from teacher views
  - does not prevent login overall (they may still be in other classrooms in the future)
  - removed students can be re-added later
- Add a settings toggle: **allow/disallow enrollment** (join code works only when enabled).
- Consider adding an optional teacher action to **email invites** (join link + code) to roster emails via Brevo.

## Assignments
- Due dates are supported but optional.
  - Default: no due date
  - If a due date is set, allow optional due time; default due time is end-of-day when unspecified.
  - Due dates should be shown to students.
- Do not compute or display late status.

### “History / AI analysis” direction
Board Google Docs revision history is not reliably available when only importing `.docx`.
To support automated history analysis, MVP should treat **Pika as the primary drafting/submission surface**:
- Provide a capable rich text editor (headings, lists, basic formatting).
- Capture activity history to support:
  - an AI-generated summary of writing activity and/or content
  - a simple activity visualization (timeline / word-count over time / paste-event markers)
- Visibility: teacher-only by default; optionally enable for students.
- Summaries apply to **assignments only** (not daily logs).
- Summaries should run **on-demand** and as a nightly batch job at **1:00am America/Toronto**.
- On-demand summaries are allowed for **drafts** and **submitted** docs.
- AI model: **OpenAI `gpt-5-mini`** (configurable).
- On-demand summarization should return cached results unless the assignment doc has changed since the last summary.
- Nightly batch recomputes summaries only for **submitted** assignment docs changed since last summary.
- Scheduled execution: Vercel Cron (configured in Vercel dashboard for **production only**) → `GET /api/cron/nightly-assignment-summaries` (protected via `CRON_SECRET`).
- Manual staging trigger (non-production only):
  - `curl -X POST \"$NEXT_PUBLIC_APP_URL/api/cron/nightly-assignment-summaries?force=1\" -H \"Authorization: Bearer $CRON_SECRET\"`

## Out of Scope (for MVP)
- Manual roster add/edit UI (beyond CSV upload + remove)
- File uploads (DOCX/PDF) and drag/drop grading workflows
- Google Drive/Classroom integration
- “Late” attendance or “late” assignments

## Open Questions
- Exact rich-text editor scope for MVP (minimum formatting set).
