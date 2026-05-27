alter table public.verification_codes
  add column if not exists handoff_token_hash text,
  add column if not exists handoff_expires_at timestamptz,
  add column if not exists handoff_consumed_at timestamptz;

create index if not exists idx_verification_codes_handoff_token_hash
  on public.verification_codes (handoff_token_hash)
  where handoff_token_hash is not null;

create index if not exists idx_verification_codes_handoff_active
  on public.verification_codes (user_id, purpose, handoff_expires_at)
  where handoff_token_hash is not null
    and handoff_consumed_at is null;
