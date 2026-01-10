# Pika Semester Plan

Comprehensive plan for running Pika during the semester with priorities:
1. **Reliability** - Prevent data loss, handle failures gracefully
2. **Grading efficiency** - Reduce teacher time reviewing submissions
3. **UI/UX polish** - Student experience improvements
4. **Feature expansion** - New capabilities as time allows

---

## Table of Contents

1. [AI Context Optimization](#ai-context-optimization)
2. [Mid-Semester Migration Strategy](#mid-semester-migration-strategy)
3. [Reliability Hardening](#reliability-hardening)
4. [Grading Efficiency](#grading-efficiency)
5. [Documentation Cleanup](#documentation-cleanup)
6. [Feature Roadmap](#feature-roadmap)

---

## AI Context Optimization

### Tiered Context Loading

| Task Complexity | Files to Load | When to Use |
|-----------------|---------------|-------------|
| **Minimal** | `CLAUDE.md` only | Typos, single-line fixes, clarifying questions |
| **Standard** | `CLAUDE.md` + `architecture.md` | Bug fixes, small features, API changes |
| **Full** | Complete reading order | New features, multi-file changes, schema work |
| **Extended** | Full + `decision-log.md` + guidance docs | Architecture changes, security work |

### Quick Reference (Add to CLAUDE.md)

For minimal-context sessions, these patterns are critical:

```
Auth Flow:
  signup → verify-signup → create-password → login
  forgot-password → reset-password/verify → reset-password/confirm

Session:
  iron-session cookie "pika_session", HTTP-only, SameSite=Lax
  requireRole('student' | 'teacher') guards API routes

Timezone:
  Always America/Toronto for deadlines
  Use date-fns-tz for all date comparisons

Database:
  Service role client in API routes
  RLS disabled; ownership enforced in route logic
```

### Context Loading Script (Optional)

Create `scripts/ai-context.sh` to output context for copy-paste into chat interfaces:

```bash
#!/bin/bash
LEVEL=${1:-standard}

case $LEVEL in
  minimal)
    cat CLAUDE.md
    ;;
  standard)
    cat CLAUDE.md docs/core/architecture.md
    ;;
  full)
    cat CLAUDE.md docs/ai-instructions.md docs/core/architecture.md \
        docs/core/design.md docs/core/tests.md
    ;;
esac
```

---

## Mid-Semester Migration Strategy

### Safe Migration Workflow

```
┌─────────────────────────────────────────────────────────┐
│ 1. DEVELOP                                              │
│    - Create worktree: docs/dev-workflow.md (migration-x)│
│    - Write migration in supabase/migrations/            │
│    - Test locally: supabase db reset                    │
└─────────────────────┬───────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────┐
│ 2. STAGE                                                │
│    - Push branch to GitHub                              │
│    - Supabase creates preview branch automatically      │
│    - Or: Create manual preview in Supabase dashboard    │
│    - Run smoke tests against staging                    │
└─────────────────────┬───────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────┐
│ 3. SCHEDULE                                             │
│    - Pick maintenance window (evening/weekend)          │
│    - Notify students if significant (optional)          │
└─────────────────────┬───────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────┐
│ 4. APPLY                                                │
│    - Supabase Dashboard → SQL Editor → Run migration    │
│    - Or: supabase db push --db-url $PROD_DB_URL         │
│    - Verify via quick smoke test                        │
└─────────────────────┬───────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────┐
│ 5. DEPLOY                                               │
│    - Merge PR to main                                   │
│    - Vercel auto-deploys                                │
│    - Monitor for errors in Vercel logs                  │
└─────────────────────────────────────────────────────────┘
```

### Migration Patterns

#### Pattern 1: Additive Columns (Zero Downtime)

```sql
-- Safe: adds column with default, no breaking changes
ALTER TABLE assignments
ADD COLUMN IF NOT EXISTS rubric jsonb DEFAULT '[]'::jsonb;
```

Deploy order: Migration → Code (code handles null/default gracefully)

#### Pattern 2: Breaking Changes (Requires Coordination)

```sql
-- Step 1: Add new column
ALTER TABLE entries ADD COLUMN content_v2 jsonb;

-- Step 2: Backfill (can run async)
UPDATE entries SET content_v2 = to_jsonb(content) WHERE content_v2 IS NULL;

-- Step 3: After code deployed and using content_v2
ALTER TABLE entries DROP COLUMN content;
ALTER TABLE entries RENAME COLUMN content_v2 TO content;
```

Deploy order:
1. Migration Step 1 + Backfill
2. Deploy code that reads both columns
3. Verify all reads use new column
4. Migration Step 3

#### Pattern 3: Index Additions (Background Safe)

```sql
-- CREATE INDEX CONCURRENTLY doesn't lock table
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_entries_date
ON entries (classroom_id, date);
```

### Rollback Procedure

1. **Additive changes**: Usually no rollback needed; code handles gracefully
2. **Data migrations**: Keep backup of affected rows before UPDATE
3. **Breaking changes**: Maintain backward-compatible code until verified

```sql
-- Example: backup before destructive change
CREATE TABLE _backup_entries_20250115 AS
SELECT * FROM entries WHERE date > '2025-01-01';
```

### Pre-Semester Checklist

- [ ] Document current schema state (export via Supabase dashboard)
- [ ] Test backup/restore procedure once
- [ ] Set up Supabase preview branches for staging
- [ ] Create rollback SQL for any planned migrations

---

## Reliability Hardening

### Priority 1: Entry Draft Autosave

**Problem**: If network fails mid-entry, student loses work.

**Solution**: LocalStorage backup with sync indicator.

```typescript
// src/lib/draft-storage.ts
const DRAFT_KEY = 'pika_entry_draft';

interface DraftEntry {
  classroomId: string;
  date: string;
  content: string;
  savedAt: number;
}

export function saveDraft(draft: DraftEntry): void {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

export function loadDraft(classroomId: string, date: string): string | null {
  const raw = localStorage.getItem(DRAFT_KEY);
  if (!raw) return null;
  const draft: DraftEntry = JSON.parse(raw);
  if (draft.classroomId === classroomId && draft.date === date) {
    return draft.content;
  }
  return null;
}

export function clearDraft(): void {
  localStorage.removeItem(DRAFT_KEY);
}
```

**UI Integration**:
- Save to localStorage on every keystroke (debounced 500ms)
- On load, check for draft newer than server version
- Show "Draft restored" toast if found
- Clear draft on successful submit

### Priority 2: Submission Retry Queue

**Problem**: Assignment submit fails silently on network error.

**Solution**: Optimistic UI with retry queue.

```typescript
// src/lib/submission-queue.ts
interface PendingSubmission {
  assignmentDocId: string;
  content: object;
  attemptedAt: number;
  retryCount: number;
}

// Store in IndexedDB for persistence across page reloads
// Retry with exponential backoff
// Show persistent banner: "Submission pending - will retry automatically"
```

### Priority 3: Error Boundary with Recovery

Add React Error Boundary to classroom views that:
- Catches render errors
- Shows friendly "Something went wrong" UI
- Offers "Reload" button
- Logs error to console for debugging

### Priority 4: Database Backup Procedure

**Weekly backup (manual for free tier)**:
1. Supabase Dashboard → Settings → Database → Backups
2. Download latest backup
3. Store securely (encrypted cloud storage)

**Restore procedure**:
1. Create new Supabase project (or reset existing)
2. Apply backup via pgAdmin or Supabase CLI
3. Update environment variables if new project

---

## Grading Efficiency

### Quick Wins (Low Effort)

#### Keyboard Navigation
Add to teacher assignment review:
- `j` / `k`: Next/previous student
- `e`: Expand/collapse current submission
- `m`: Mark as viewed
- `Esc`: Return to list

#### Bulk Actions
- "Mark all as viewed" button
- "Export grades" CSV with columns: student, submitted_at, word_count, status

### Medium Effort

#### Quick Feedback Snippets
Teacher can save common feedback phrases:
- "Great work! Your analysis shows deep understanding."
- "Please expand on your reasoning in paragraph 2."
- "Missing: connection to course themes."

Store in localStorage or user preferences table.

#### Simple Rubric Template
```typescript
interface RubricItem {
  criterion: string;
  points: number;
  maxPoints: number;
}

interface AssignmentRubric {
  items: RubricItem[];
  totalPoints: number;
}
```

UI: Checklist-style rubric that auto-calculates total.

---

## Documentation Cleanup

### Files to Archive/Remove

| File | Action | Reason |
|------|--------|--------|
| `docs/workflow/load-context.md` | Delete | Covered by `ai-instructions.md` |
| `docs/workflow/load-context-minimal.md` | Delete | Covered by `ai-instructions.md` |
| `docs/core/pilot-mvp.md` | Archive to `docs/archive/` | Historical; pilot decisions made |
| `docs/issues/archive/*` | Keep | Already archived properly |

### JOURNAL.md Management

Add to `.ai/START-HERE.md`:

```markdown
### Journal Maintenance

When JOURNAL.md exceeds 1500 lines:
1. Create `.ai/archive/JOURNAL-YYYY-MM.md`
2. Move entries older than 30 days to archive
3. Keep last 50 entries in active journal
```

### Documentation Line Targets

| Document | Current | Target | Notes |
|----------|---------|--------|-------|
| `ai-instructions.md` | 350 | 300 | Remove workflow duplication |
| `architecture.md` | 210 | 200 | Already tight |
| `design.md` | 715 | 400 | Move component examples to storybook/gallery |
| `JOURNAL.md` | 1374 | 500 | Archive older entries |
| **Total** | ~7200 | ~4000 | 44% reduction |

---

## Feature Roadmap

### Before Semester Starts

- [ ] Entry draft autosave (localStorage)
- [ ] Submission retry queue
- [ ] Error boundary for classroom views
- [ ] Document backup procedure
- [ ] Create migration workflow doc
- [ ] Archive stale docs, reduce token load

### Month 1 (Grading Focus)

- [ ] Keyboard navigation in assignment review
- [ ] Bulk "mark as viewed"
- [ ] Grade export CSV
- [ ] Quick feedback snippets

### Month 2 (Analytics)

- [ ] At-risk student flag (3+ absences)
- [ ] Attendance trend per student
- [ ] Weekly teacher summary email

### Month 3+ (As Needed)

- [ ] Teacher announcements per classroom
- [ ] Due date reminders (email)
- [ ] Student engagement metrics (streaks, badges)

---

## Implementation Checklist

Copy this to GitHub Issues or your task tracker:

```markdown
## Pre-Semester Hardening

- [ ] #1 Entry draft autosave
  - [ ] Create src/lib/draft-storage.ts
  - [ ] Integrate into StudentTodayTab
  - [ ] Add "Draft restored" toast
  - [ ] Test: close tab mid-entry, reopen, verify restored

- [ ] #2 Submission retry queue
  - [ ] Create src/lib/submission-queue.ts
  - [ ] Add IndexedDB storage
  - [ ] Show pending banner
  - [ ] Test: submit offline, go online, verify syncs

- [ ] #3 Error boundaries
  - [ ] Create ErrorBoundary component
  - [ ] Wrap classroom views
  - [ ] Add "Reload" recovery button

- [ ] #4 Documentation
  - [ ] Create docs/workflow/migrations.md
  - [ ] Archive pilot-mvp.md
  - [ ] Delete load-context*.md
  - [ ] Archive JOURNAL entries > 30 days

- [ ] #5 Backup procedure
  - [ ] Document in docs/deployment/backup.md
  - [ ] Test restore to fresh project
```

---

## Questions for Stakeholder Review

1. **Maintenance windows**: Are there specific times students are never working? (e.g., 11pm-6am Toronto time)
2. **Notification preference**: Email for due dates, or in-app only?
3. **Grading depth**: Do you need rubrics/points, or just completion tracking?
4. **Data retention**: How long to keep student entries after semester ends?

---

*Document created: 2025-12-31*
*Last updated: 2025-12-31*
