# Assignment UX Language

This document codifies the current assignments experience as a reusable design language. It is the primary source of truth for the look, feel, structure, and interaction rhythm of assignment-style work in Pika.

The goal is not to freeze every pixel. The goal is to preserve the recognizable system:

- calm page shell
- content-first browsing
- restrained controls
- clear summary-to-detail progression
- assignment-family cards and surfaces

If another surface borrows from assignments later, it should feel like a descendant of this system rather than a separate tool.

## Canonical Sources

Read these files before reproducing the assignment experience:

- Teacher assignments summary and workspace:
  - `src/app/classrooms/[classroomId]/TeacherClassroomView.tsx`
- Student assignments summary and editor entry:
  - `src/app/classrooms/[classroomId]/StudentAssignmentsTab.tsx`
- Assignment list card:
  - `src/components/SortableAssignmentCard.tsx`
- Shared shell primitives:
  - `src/components/PageLayout.tsx`
  - `src/ui/EmptyState.tsx`

These files define the real implementation. This doc explains the design language they express.

## Required Primitives

Assignment-style surfaces should prefer the same primitives already used by assignments:

- `PageLayout`
- `PageActionBar`
- `PageContent`
- `PageStack`
- `EmptyState`
- semantic tokens such as `bg-surface`, `bg-surface-panel`, `bg-surface-2`, `border-border`, `border-border-strong`, `text-text-default`, `text-text-muted`

Do not invent a new page shell when the assignment shell already fits the state.

## Core Character

### Quiet shell

Assignments feel calm because the shell stays out of the way:

- one stable action bar
- broad, readable content area
- light framing
- minimal decorative chrome

The eye should land on the work list or the current work item first, not on controls, tabs, or placeholders.

### Content-first hierarchy

Assignments always prioritize the work itself:

- titles and due/status information come first
- controls are present but visually secondary
- empty states are simple and direct
- detail views appear because the user chose a work item, not because the layout pre-allocates inspector space

### Soft, practical polish

Assignments are not flat, but they are restrained:

- soft borders
- small elevation
- gentle hover movement
- compact chips
- muted secondary copy

The system feels purposeful, not ornamental.

## Teacher Assignments

Teacher assignments have two dominant states: summary and workspace.

### Summary state

The summary state is the default browsing view.

It should feel like:

- a single list surface
- a sparse top action bar
- full-width cards with clear scanning rhythm
- no reserved detail pane before selection

Visual characteristics:

- `PageLayout` fills the available height
- `PageActionBar` sits at the top without heavy framing
- `PageContent` uses modest vertical spacing
- `PageStack` separates cards evenly
- cards span the available content width

### Workspace state

Once a teacher selects an assignment, the interface can become denser and more tool-like, but it still keeps the same shell.

Important behavior:

- detail appears because selection changed
- the calm outer shell remains consistent
- tables, grading panes, and side content are justified by active review work

The assignments system earns complexity only after the user is inside the work.

## Student Assignments

Student assignments have a simpler progression than teacher assignments.

### Summary state

The student summary state is straightforward:

- no extra header chrome when not needed
- vertically stacked cards
- strong title, muted due information, compact status chip
- full-width browsing experience

The list should feel like a clean queue of work.

### Selected state

When a student opens an assignment:

- the list yields to the focused work view
- the active task becomes the main surface
- supporting actions stay close to the work

The interaction pattern is summary to focused work, not summary beside an always-present inspector.

### Empty state

Student empty states are especially quiet:

- one `EmptyState`
- short explanatory copy
- no extra border maze or placeholder panel

## Card Anatomy

`SortableAssignmentCard` defines the teacher assignment card language.

### Teacher card structure

The card has a clear left-to-right order:

1. drag handle
2. title and due information
3. compact status or submission summary
4. light action icons

What matters:

- title is the strongest text
- due metadata is muted
- status is compact
- actions do not dominate the row

### Student card structure

The student assignment card is simpler:

1. title
2. due metadata
3. compact relative timing or supporting copy
4. status chip

It should scan quickly and feel lighter than a dashboard tile.

## Layout Rules

### Width

Assignment browsing states use the available content width.

- do not artificially narrow the browsing surface unless the assignment implementation already does
- do not leave a silent empty column beside the list
- do not reserve future detail space in the default state

### Spacing

Assignments use consistent breathing room:

- modest action-bar spacing
- clear but not oversized gaps between cards
- enough padding for readability without feeling loose

### Selection

Selection changes the layout only when necessary.

- summary state should feel complete on its own
- detail state should appear because the user selected something
- pre-selection placeholder panes are not part of the assignment language

## Action Hierarchy

Assignments use a very clear action order.

### Primary action

There is usually one obvious primary action:

- `New`
- `Submit`
- another single current task action

It is visible, but not oversized.

### Secondary actions

Secondary actions stay quieter:

- icon buttons
- subtle buttons
- compact supporting controls

They should read as utilities, not as the focal point of the page.

### Stability

The action bar should not jump between radically different structures across nearby states. Assignment surfaces feel coherent because the shell stays recognizable while content changes.

## Copy Tone

Assignment copy is terse and product-like.

Use:

- short titles
- direct descriptions
- muted secondary guidance

Avoid:

- tutorial-like paragraphs
- redundant labels
- over-explaining status

The assignments voice is calm, plain, and concise.

## What To Preserve

When reproducing the assignment experience, preserve:

- the quiet shell
- full-width browsing surfaces
- restrained card styling
- short copy
- selection-driven detail
- semantic-token usage
- existing `@/ui` and page-shell primitives

## What Not To Introduce

Do not introduce any of the following into an assignment-style surface:

- default split panes before selection
- placeholder inspector panels
- loud toggle bars
- dashboard chrome
- bespoke card families unrelated to assignment cards
- extra framing around empty states
- raw `dark:` classes in app code

## AI Reproduction Checklist

If an AI needs to reproduce the assignment style, it should verify:

- `PageLayout` is the outer shell
- `PageActionBar` stays sparse and stable
- `PageContent` and `PageStack` control the browsing rhythm
- cards fill the available content width
- the first visual emphasis is on content, not controls
- empty states use a single quiet surface
- detail appears only after selection
- status chips are compact
- copy stays short and muted

## Reuse Guidance

If another feature later borrows from assignments, use this rule:

Start from the assignment shell and only add complexity when the task truly requires it.

That means:

- browse like assignments
- select like assignments
- only become denser when active work or review genuinely needs it

This keeps future surfaces in the same product family even if the exact domain behavior differs.
