# Daily Log Summaries — Smoke Checklist

Goal: confirm teacher Logs show cached 1-line summaries generated nightly (no on-demand generation).

## Prereqs

- Migration applied: `supabase/migrations/010_entry_summaries.sql`
- Vercel env set:
  - `OPENAI_API_KEY`
  - (optional) `OPENAI_DAILY_LOG_SUMMARY_MODEL` (defaults to `gpt-5-nano`)
- Nightly cron schedule active for `/api/cron/nightly-assignment-summaries`
  - It runs at `06:00 UTC` (~1am Toronto in winter, ~2am in summer)

## Steps

1. As a student, submit a daily log entry for a class day.
2. As a teacher, open the classroom → `Logs` tab and confirm:
   - The row shows the entry text, and indicates `Summary pending (generated nightly)` until the cron runs.
3. After the nightly cron runs, open the same `Logs` date again and confirm:
   - A 1-line summary appears for that student.
4. Confirm no regeneration:
   - Edit the student entry text after the summary exists.
   - Wait for the next cron run and confirm the summary does **not** change.

## Optional (non-production only)

You can trigger the cron handler with `force=1` outside production:

```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  "$NEXT_PUBLIC_APP_URL/api/cron/nightly-assignment-summaries?force=1"
```

