# Pika Marketing Capture Plan (Website-first)

## Goal
Create believable demo media for `/codepetca/pika-web` using fake but realistic classroom data.

## Demo Data Setup
Run from repo root:

```bash
pnpm seed:marketing
```

Then generate screenshots and voiceover:

```bash
pnpm capture:marketing
pnpm voiceover:marketing
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
1. Start app and login as teacher/student in separate browser profiles.
2. Capture raw screenshots first, then re-capture polished/cropped variants.
3. Record short action clips per storyboard section (6-12 seconds each).
4. Edit final promo at 60 seconds with subtitles and soft transitions.
5. Export:
   - `/marketing/pika-hero.mp4` (website)
   - `/marketing/pika-hero.webm` (website alt)
   - `/marketing/pika-hero-poster.png`
   - `/marketing/screens/*.png`

## Current Automation Notes
- `pnpm capture:marketing` auto-resolves the demo classroom by class code (`MKT101` by default).
- Override class code/base URL:
  - `CAPTURE_CLASS_CODE=MKT201 CAPTURE_BASE_URL=http://localhost:3017 pnpm capture:marketing`
- `pnpm voiceover:marketing` outputs:
  - `artifacts/marketing/audio/pika-voiceover-60s.aiff`
- `ffmpeg` is required separately for final MP4/WebM assembly.

## Next Repurposing Plan
- 1:1 square cut for social feed
- 9:16 vertical cut for reels/shorts
- 2-3 minute narrated walkthrough for onboarding
