# Snapshot Gallery

The snapshot gallery provides a visual interface to view all captured UI screenshots from Playwright tests.

## Quick Start

1. **Generate snapshots:**
   ```bash
   pnpm run e2e:snapshots:update
   ```

2. **Start the dev server:**
   ```bash
   pnpm run dev
   ```

3. **View the gallery:**
   Open http://localhost:3000/snapshots-gallery in your browser

## Features

### Gallery View
- **Grid layout** displaying all snapshots (25 total)
- **Filter buttons** to view specific categories:
  - All (all snapshots)
  - Auth (login, signup, password reset) - 3 snapshots
  - Teacher (dashboard, classroom views, assignments) - 16 snapshots (8 light + 8 dark)
  - Student (today view, history, assignments, join) - 8 snapshots (4 light + 4 dark)

### Snapshot Cards
Each snapshot card shows:
- **Readable name** (e.g., "Auth Login")
- **Preview image** (aspect ratio 4:3, object-fit contain)
- **Full filename** (e.g., `auth-login-chromium-desktop-darwin.png`)
- **Click to view** full-size image in new tab

### API Endpoints

**List all snapshots:**
```
GET /api/snapshots/list
```
Returns JSON array of snapshot metadata.

**View individual snapshot:**
```
GET /api/snapshots/[filename]
```
Serves the PNG image file with proper caching headers.

## Use Cases

### UI/UX Development
- Review all screens at once
- Compare layouts across roles (teacher vs student)
- Identify inconsistencies in spacing, colors, or typography

### AI Review
- AI can access snapshots via the API endpoints
- Snapshots are standard PNG files for easy analysis
- Filenames clearly indicate screen purpose

### Documentation
- Use snapshots in design documentation
- Share visual examples with stakeholders
- Track UI evolution over time

## Directory Structure

```
e2e/
├── __snapshots__/
│   └── ui-snapshots.spec.ts-snapshots/
│       ├── auth-login-chromium-desktop-darwin.png
│       ├── teacher-classroom-attendance-chromium-desktop-darwin.png
│       ├── teacher-classroom-attendance-dark-chromium-desktop-darwin.png
│       └── ... (25 total snapshots - light + dark mode)
├── auth.setup.ts
└── ui-snapshots.spec.ts

src/app/
├── snapshots-gallery/
│   ├── page.tsx
│   └── SnapshotGallery.tsx
└── api/snapshots/
    ├── list/route.ts
    └── [filename]/route.ts
```

## Implementation Details

### Security
- Only serves PNG files from the snapshots directory
- Prevents directory traversal attacks
- No authentication required (development tool)

### Performance
- Images cached for 1 hour (`Cache-Control: public, max-age=3600`)
- Lazy loading for snapshot images
- Lightweight API responses

### Browser Compatibility
- Works in all modern browsers
- Responsive grid layout
- Mobile-friendly (though snapshots are desktop-sized)

## Commands

| Command | Description |
|---------|-------------|
| `pnpm run e2e:snapshots` | Run tests and compare with baselines |
| `pnpm run e2e:snapshots:update` | Update snapshot baselines |
| `pnpm run dev` | Start dev server to view gallery |

## Notes

- Gallery only shows snapshots that exist in the filesystem
- If no snapshots are found, displays instructions to generate them
- Snapshots are gitignored (generated locally)
- Gallery is a development tool (not deployed to production)
