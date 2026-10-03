#!/usr/bin/env bash
set -euo pipefail
set +x

# Coordinator-run only; this file does not apply migrations or change .env.local.
# Credentials come exclusively from this exact running local status invocation.
ack='I_UNDERSTAND_THIS_CREATES_AND_REMOVES_ONLY_LOCAL_ASSIGNMENT_FIXTURES'
if [[ "${1:-}" != "--ack=$ack" ]]; then
  echo 'Explicit local synthetic Assignment write acknowledgement required.' >&2
  exit 1
fi
mode="${2:-normal}"
case "$mode" in normal|after-fixture|before-capture) ;; *) echo 'Unknown local proof mode.' >&2; exit 1 ;; esac
if [[ "$#" -gt 2 ]]; then echo 'Unexpected proof arguments.' >&2; exit 1; fi
proof_root="$(git rev-parse --show-toplevel)"
cd "$proof_root"
status_json="$(supabase status --workdir "$proof_root" -o json 2>/dev/null)" || {
  echo 'Local Supabase status unavailable (captured output withheld).' >&2; exit 1;
}
status_value() {
  PIKA_SHARED_STATUS_JSON="$status_json" node -e '
    try {
      const status = JSON.parse(process.env.PIKA_SHARED_STATUS_JSON || "{}");
      for (const key of process.argv.slice(1)) {
        if (typeof status[key] === "string" && status[key].trim()) {
          process.stdout.write(status[key]);process.exit(0);
        }
      }
    } catch {}
    process.exit(1);
  ' "$@"
}
export PIKA_SHARED_ASSIGNMENT_WRITE_API="$(status_value API_URL)"
export PIKA_SHARED_ASSIGNMENT_WRITE_DB="$(status_value DB_URL)"
export PIKA_SHARED_ASSIGNMENT_WRITE_SECRET="$(status_value SERVICE_ROLE_KEY)"
export PIKA_SHARED_ASSIGNMENT_WRITE_PUBLIC="$(status_value PUBLISHABLE_KEY ANON_KEY)"
export PIKA_SHARED_ASSIGNMENT_WRITE_ACK="$ack"
export PIKA_SHARED_ASSIGNMENT_WRITE_WRAPPER='local-status-v1'
export PIKA_SHARED_ASSIGNMENT_WRITE_MODE="$mode"
# Capture the runner's output: never echo raw rows, command failures or secrets.
proof_logs="$(mktemp -d -t pika-shared-assignment-proof.XXXXXX)"
trap 'rm -f "$proof_logs/runner.log"; rmdir "$proof_logs"' EXIT
rc=0
pnpm vitest run tests/api/integration/shared-assignment-writes.local.test.ts --maxWorkers=1 --no-file-parallelism \
  >"$proof_logs/runner.log" 2>&1 || rc=$?
cleanup='PASS shared-assignment exact cleanup; whole-row baseline equal; zero residue; guard168 O'
normal='PASS shared-assignment actual routes and real RPCs; shared cohort only; old pair gates OFF'
forced=''
case "$mode" in
  after-fixture) forced='FAIL shared-assignment FORCED_AFTER_FIXTURE' ;;
  before-capture) forced='FAIL shared-assignment FORCED_COMMIT_BEFORE_CAPTURE' ;;
esac
if ! rg -F -x "$cleanup" "$proof_logs/runner.log" >/dev/null; then
  echo 'FAIL shared-assignment verified cleanup receipt missing (runner output withheld).' >&2; exit 1
fi
echo "$cleanup"
if [[ "$mode" == normal && "$rc" == 0 ]] && rg -F -x "$normal" "$proof_logs/runner.log" >/dev/null; then
  echo "$normal"; exit 0
fi
if [[ "$mode" != normal && "$rc" == 1 ]] && rg -F -x "$forced" "$proof_logs/runner.log" >/dev/null \
  && ! rg -F -x 'FAIL shared-assignment cleanup (captured data withheld)' "$proof_logs/runner.log" >/dev/null; then
  echo "$forced"; exit 1
fi
echo 'FAIL shared-assignment unexpected proof outcome (runner output withheld).' >&2
exit 1
