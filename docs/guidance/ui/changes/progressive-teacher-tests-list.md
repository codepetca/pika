# Progressive teacher Tests list

Owner request 2026-11-03: show the teacher's Tests list promptly and retain the existing submitted/open/closed counts once available. The approved reference is the existing Tests summary card in the teacher work-surface canon and `/pattern-lab` teacher work surfaces. Roles: teacher; student n/a (unchanged). Verify desktop and mobile, light and dark, with pending, loaded, empty, and failed statistics. Primary signal: actual Test titles while statistics load, never fabricated counts. Unverified statistics keep workspace actions unavailable. Excludes student Tests, grading semantics, and shared classroom admission. No new composite widget.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| List and cards | TeacherWorkItemList / TeacherWorkItemCardFrame | reuse | Same teacher work surface and hierarchy |
| Pending indicator | RefreshingIndicator | reuse | Explains the secondary read while list remains visible |
| Failure and retry | Existing Tests error and Button | extend | Retain useful summary and offer retry |
| Statistics | Existing Test-specific card and status | reuse | Preserve domain counts and labels once authoritative |
