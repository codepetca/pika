# Route Patterns

This document explains the routing architecture for Pika to prevent confusion about apparent "duplicate" routes.

## Two Complementary Patterns

### Pattern 1: Multi-Classroom Views (Legacy Routes)

**Purpose**: View/manage across ALL user's classrooms with sidebar selection

**Routes**:
- `/teacher/calendar` - Select from all classrooms, manage calendar for one
- `/student/history` - Select from all joined classrooms, view history for one

**UX Pattern**:
- Sidebar shows all classrooms
- Main content area shows selected classroom's data
- Useful for quick switching between classrooms

### Pattern 2: Classroom Shell (Primary)

**Purpose**: Deep dive into a SINGLE classroom with tabs

**Route**: `/classrooms/[id]`

**Tabs** (role-based):
- Teacher: Attendance, Logs, Assignments, Roster, Calendar, Settings
- Student: Today, History, Assignments

**UX Pattern**:
- Already scoped to one classroom
- Tab-based navigation for different classroom views
- Primary entry point after login

## Why Both Exist

1. **Different navigation models**: Multi-classroom sidebar vs single-classroom tabs
2. **Different use cases**:
   - Quick classroom switching (legacy)
   - Deep classroom management (shell)
3. **Migration strategy**: Classroom shell is primary, but legacy routes remain for specific workflows

## Navigation Flow

```
Login
  ↓
/classrooms (landing)
  ↓
  ├─→ Teacher: Classrooms list → select → /classrooms/[id]
  └─→ Student: Auto-route to most recent → /classrooms/[id]

Alternative entry (in nav):
  ├─→ Teacher: /teacher/calendar (multi-classroom calendar view)
  └─→ Student: /student/history (multi-classroom history view)
```

## For AI Agents

When implementing new features:
- **Default**: Use classroom shell (`/classrooms/[id]`) and add tabs as needed
- **Only if**: Feature requires multi-classroom selection, consider legacy pattern
- **Never**: Create third routing pattern without architectural discussion

## Notes

- Both patterns are intentional and should be maintained
- Do not create redirects from legacy routes to classroom shell (breaks multi-classroom UX)
- Future enhancement: Consider consolidating into unified pattern if complexity grows
