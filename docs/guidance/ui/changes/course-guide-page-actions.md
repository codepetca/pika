# Course Guide Page Actions

User-approved refinement: the Course Guide is a single teacher-authored document. Its teacher
surface uses the shared `PageActionBar` with a far-right More actions menu. `Edit` opens the visual
editor directly in the page, while `Edit with Markdown` opens a paste-friendly source editor for the
same saved document. The former floating edit cluster and separate Resources section are removed.

## Ownership

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Page-level actions | `PageActionBar` | reuse | It owns the right-aligned More menu, focus, and keyboard behavior. |
| Visual document editing | `MarkdownContentEditor` | extend | The existing Course Guide markdown field remains the persistence boundary. |
| Markdown source editing | Assignment/test source editor pattern | reuse | A labeled native textarea provides the established paste-friendly source workflow. |
| Resources | Course Guide Resources section | remove | The Course Guide now has one authored document rather than a second content editor. |

## Verification brief

- **Surface:** teacher classroom Course Guide action bar and inline document editor; shared
  teacher/student/public Course Guide presentation.
- **Reference:** Assignments/Tests `PageActionBar` More menu and their visual/Markdown editor modes.
- **Roles:** teacher interaction; student and public read-only regression coverage.
- **Viewports:** desktop and mobile.
- **Themes:** light and dark.
- **States:** read, More menu open, visual edit, Markdown edit, saving/error, archived read-only.
- **Primary signal:** a quiet More trigger at the right edge; document content remains dominant.
- **Must not add:** a floating action cluster, Resources section, second saved document, decorative
  chrome, or a new shared primitive.
- **Composite accessibility:** required for the shared More menu; retain its focus movement,
  keyboard navigation, Escape close, and focus restoration behavior.

Stable guidance followed: yes. Experimental guidance introduced: no. Human promotion needed: no.
Global tokens or canonical primitives changed: no.
