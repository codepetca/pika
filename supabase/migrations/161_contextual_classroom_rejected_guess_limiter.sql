-- Forward-only adopter for contextual join guesses rejected before the
-- migration 159 atomic admission function can charge the attempt.

create function public.consume_classroom_join_guess_v1(
  p_actor_key_hash text,
  p_invitation_key_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rate_limit jsonb;
begin
  v_rate_limit := private.consume_classroom_join_rate_limits_v1(
    p_actor_key_hash,
    p_invitation_key_hash
  );
  if not coalesce((v_rate_limit->>'ok')::boolean, false) then
    return jsonb_build_object(
      'ok', false,
      'status', 429,
      'error_code', 'rate_limited',
      'retry_after_seconds', (v_rate_limit->>'retry_after_seconds')::integer
    );
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.consume_classroom_join_guess_v1(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.consume_classroom_join_guess_v1(text, text)
  to service_role;

comment on function public.consume_classroom_join_guess_v1(text, text) is
  'Service-only limiter for contextual join guesses rejected before atomic admission.';
comment on function public.join_classroom_by_code_atomic_v1(uuid, uuid, text, text, text, text, text, text, jsonb) is
  'Service-only atomic classroom join primitive for the disabled-by-default contextual pilot path.';
