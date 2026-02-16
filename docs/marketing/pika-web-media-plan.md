# Pika Marketing Capture Plan (Website-first)

## Goal
Create believable demo media for `/codepetca/pika-web` using fake but realistic classroom data.

## Demo Data Setup
Run from repo root:

```bash
ALLOW_MARKETING_SEED=true pnpm seed:marketing
```

Generate everything (seed/auth/screens/video/audio/captions/bundle):

```bash
ALLOW_MARKETING_SEED=true CAPTURE_BASE_URL=http://localhost:3017 pnpm build:marketing
```

Or run phases manually:

```bash
ALLOW_MARKETING_SEED=true pnpm seed:marketing
pnpm auth:marketing
pnpm capture:marketing
pnpm walkthrough:marketing
pnpm voiceover:marketing
pnpm captions:marketing
pnpm video:marketing
pnpm bundle:marketing
```

Demo credentials:
- Teacher: `teacher.marketing@example.com` / `test1234`
- Student sample: `ava.chen@example.com` / `test1234`

Created demo classrooms:
- `Pika Demo - English 10` (`MKT101`)
- `Pika Demo - Learning Strategies` (`MKT201`)

Data profile:
- 12 students with varied attendance patterns
- mixed assignment states: drafted, in-progress, submitted, graded, returned
- grading + feedback + authenticity + history snapshots seeded

## Screenshot Shot List (12)
Use 1440x900 for desktop hero/feature cards.

1. Teacher classrooms overview (clean list + active classes)
2. Teacher assignments list (left list + markdown panel)
3. Teacher student work panel (status/grade/updated compact table)
4. Teacher grading pane (completion/thinking/workflow + feedback)
5. Teacher history/authenticity panel view
6. Attendance panel with mixed present/absent pattern
7. Student assignments list (submitted/in progress badges)
8. Student editor with assignment instructions
9. Student history timeline view
10. Student returned-work/grade feedback state
11. Join-class flow screen (student)
12. Responsive/mobile classroom snapshot

## 60-second Video Storyboard (Modern + Playful)

### Sequence
1. Hook (0-6s): classrooms + “Pika Classroom” title card
2. Daily rhythm (6-16s): attendance/check-ins panel
3. Assignment workflow (16-30s): create assignment -> student drafting
4. Grading workflow (30-45s): teacher rubric clicks, feedback, return work
5. Student clarity (45-55s): returned work + status + feedback
6. End card (55-60s): CTA

### Voiceover Draft
"Teaching moves fast. Pika Classroom keeps everything in sync, without extra admin.
Daily check-ins turn into clear attendance, so you can spot trends early.
Assignments are simple to launch, easy for students to complete, and quick to review.
With clear grading, feedback, and return flow, students always know what to do next.
Pika Classroom makes online and in-person learning feel simple.
Try Pika Classroom."

## Capture Workflow
1. Start app locally on `http://localhost:3017`.
2. Seed deterministic demo data (`ALLOW_MARKETING_SEED=true` required).
3. Generate auth storage for teacher + student marketing accounts.
4. Capture screenshots with deterministic URLs/selectors.
5. Record scripted teacher/student walkthrough clips.
6. Render silent + narrated + web variants + poster + 9:16 + 1:1.
7. Build publish bundle with manifest under `artifacts/marketing/publish`.

## Current Automation Notes
- `pnpm capture:marketing` auto-resolves the demo classroom by class code (`MKT101` by default).
- Override class code/base URL:
  - `CAPTURE_CLASS_CODE=MKT201 CAPTURE_BASE_URL=http://localhost:3017 pnpm capture:marketing`
- `pnpm voiceover:marketing` outputs:
  - `artifacts/marketing/audio/pika-voiceover-60s.aiff`
- `pnpm captions:marketing` outputs:
  - `artifacts/marketing/captions/pika-voiceover-60s.srt`
- `pnpm video:marketing` outputs:
  - `artifacts/marketing/video/pika-walkthrough-60s.mp4`
  - `artifacts/marketing/video/pika-walkthrough-60s-silent.mp4`
  - `artifacts/marketing/video/pika-walkthrough-60s.webm`
  - `artifacts/marketing/video/pika-walkthrough-poster.png`
  - `artifacts/marketing/video/pika-walkthrough-60s-9x16.mp4`
  - `artifacts/marketing/video/pika-walkthrough-60s-1x1.mp4`
- `pnpm bundle:marketing` outputs:
  - `artifacts/marketing/publish/**`
  - `artifacts/marketing/publish/manifest.json`

## Next Repurposing Plan
- 1:1 square cut for social feed
- 9:16 vertical cut for reels/shorts
- 2-3 minute narrated walkthrough for onboarding
