-- Rollback-only regression. Run in the isolated billing replay.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
update private.stripe_billing_settings set sandbox_enabled=true where singleton;

do $$
declare
  v_subjects uuid[]:=array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  v_expired_at timestamptz;
  v_result jsonb;
  v_case integer;
begin
  for v_case in 1..3 loop
    insert into public.users(id,email,role)
      values(v_subjects[v_case],'billing-expiry-conflict-'||v_case||'@example.invalid','teacher');
    if not exists(select 1 from public.account_plans where subject_user_id=v_subjects[v_case]) then
      perform public.set_account_plan_v1(gen_random_uuid(),v_subjects[v_case],'free','test:expiry','fixture',0);
    end if;
    perform public.billing_start_trial_v1(jsonb_build_object('subject_user_id',v_subjects[v_case],'operation_id',gen_random_uuid()));
    v_expired_at:=clock_timestamp()-make_interval(hours=>4-v_case);
    update public.billing_trials set started_at=v_expired_at-interval '720 hours',ends_at=v_expired_at
      where subject_user_id=v_subjects[v_case];
    update public.billing_account_access set starts_at=v_expired_at-interval '720 hours',access_ends_at=v_expired_at
      where subject_user_id=v_subjects[v_case];
    update public.effective_feature_entitlements set starts_at=v_expired_at-interval '720 hours',expires_at=v_expired_at
      where subject_user_id=v_subjects[v_case] and feature_key='classrooms.create';
  end loop;

  -- The conflicting rows sort first. A limit of one must still expire the
  -- unrelated healthy trial while leaving both newer revisions intact.
  update public.account_plans set revision=revision+1 where subject_user_id=v_subjects[1];
  update public.effective_feature_entitlements set revision=revision+1
    where subject_user_id=v_subjects[2] and feature_key='classrooms.create';
  v_result:=public.billing_apply_due_access_v1('{"limit":1}');
  if v_result is distinct from '{"processed":1}'::jsonb
    or not exists(select 1 from public.billing_account_access where subject_user_id=v_subjects[3] and expiry_applied_at is not null)
    or (select plan_key from public.account_plans where subject_user_id=v_subjects[3]) is distinct from 'free'
    or exists(select 1 from public.billing_account_access where subject_user_id=any(v_subjects[1:2]) and expiry_applied_at is not null)
    or exists(select 1 from public.billing_lifecycle_audit where subject_user_id=any(v_subjects[1:2]) and reason='subscription_expired') then
    raise exception 'Expiry conflict prevented independent expiry or overwrote newer state: %',v_result;
  end if;
  if public.billing_apply_due_access_v1('{"limit":1}') is distinct from '{"processed":0}'::jsonb then
    raise exception 'Expiry replay changed effective access';
  end if;
end $$;
rollback;
