# API Boundary Validation

Use this guide when adding or changing an API route, package importer, file decoder, or external/AI JSON boundary.

## Core Rule

Treat all boundary input as `unknown` and validate it exactly once before it enters application or persistence logic.

For HTTP routes, keep this order:

1. Authenticate and authorize the caller.
2. Parse route params, query values, and the request body with a named Zod schema.
3. Pass the parsed value to application or server modules.
4. Map the result to an HTTP response.

```ts
const user = await requireRole('teacher')
const input = updateCourseBlueprintSchema.parse(await request.json())
const result = await updateCourseBlueprint(user.id, blueprintId, input)
return NextResponse.json(result)
```

Do not repeat primitive field checks in route handlers or cast `request.json()` to a trusted type. `withErrorHandler` maps `ZodError` to a `400` response, so new routes should not add local validation `try/catch` blocks.

## Contract Ownership

- Put feature-owned request schemas in a focused module under `src/lib/validations/`, such as `course-blueprints.ts`.
- Put genuinely shared primitives in a narrowly named module, such as `course-publishing.ts`.
- Keep broad role-based modules such as `teacher.ts` limited to contracts that are actually shared by that role's surface.
- Derive internal input types with `z.infer<typeof schema>` when a type is needed; do not maintain a parallel handwritten request type.
- Reuse domain validators inside a boundary schema when nested data already has a canonical validator. Do not implement a second, weaker version in the route.

Zod validates transport shape and domain input constraints. Generated Supabase types and database constraints remain separate defenses for persistence shape and invariants.

## Non-JSON Boundaries

Multipart forms, imported packages, uploaded documents, and AI/external JSON still require named decoders or schemas. Validate metadata before consuming files, bound collection and payload sizes, and pass only decoded values into domain code. The API architecture ratchet currently detects `request.json()` and `request.formData()` usage; it does not prove that every file or external-data decoder is complete.

## Architecture Ratchet

`tests/unit/api-route-standards.test.ts` compares body-reading routes against `tests/architecture/api-zod-boundary-baseline.json`.

- New body-reading routes must use a named `*Schema.parse(...)` or `*Schema.safeParse(...)` boundary.
- When an existing route gains a Zod boundary, remove its path from the baseline in the same change.
- Keep the baseline sorted and duplicate-free.
- Do not add a path merely to make the test pass. Any unavoidable addition requires explicit architecture review and a documented migration owner.

The baseline is migration debt, not an exemption list. Its expected direction is toward zero.
