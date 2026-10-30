-- Queue contracts against the minimal disposable prerequisite fixture from
-- check-repolight-provision-outbox.sh; not the full billing lifecycle proof.
-- No provider call; all fixture changes roll back.
begin;
do $proof$
declare teacher uuid:='11111111-1111-4111-8111-111111111111'; c jsonb; old_claim jsonb; result jsonb; i integer;
begin
 if has_table_privilege('service_role','private.repolight_provision_outbox','SELECT')
 or has_function_privilege('anon','public.repolight_provision_outbox_v1(text,jsonb)','EXECUTE')
 or has_function_privilege('authenticated','public.repolight_provision_outbox_v1(text,jsonb)','EXECUTE')
 or not has_function_privilege('service_role','public.repolight_provision_outbox_v1(text,jsonb)','EXECUTE') then
  raise exception 'Private queue ACL contract differs';end if;
 -- The minimal native fixture deliberately isolates queue behavior from the
 -- already independently tested billing entitlement resolver and registry297.
 -- Legacy identity roles do not determine account-plan eligibility.
 insert into public.users(id,role) values(teacher,'student');
 insert into public.account_plans values(teacher,1,'plus','trial');
 insert into public.effective_feature_entitlements values(teacher,'classrooms.create',1,true,'trial',clock_timestamp(),null);
 insert into public.billing_account_access(subject_user_id,revision,account_plan_revision,entitlement_revision,starts_at,access_ends_at)
 values(teacher,1,1,1,clock_timestamp(),clock_timestamp()+interval '1 day');
 if exists(select 1 from private.repolight_provision_outbox where teacher_id=teacher)
 or public.repolight_provision_outbox_v1('claim') is not null then raise exception 'Dormant queue produced work';end if;
 update private.repolight_settings set managed_provisioning_enabled=true where singleton;
 -- Retroactive activation requires no teacher setup and no backfill migration.
 c:=public.repolight_provision_outbox_v1('claim',jsonb_build_object('teacherId',teacher));
 if c->>'teacherId' is distinct from teacher::text or (c->>'attempt')::int<>1 then raise exception 'Retroactive claim failed';end if;
 if public.repolight_provision_outbox_v1('claim',jsonb_build_object('teacherId',teacher)) is not null then raise exception 'Concurrent active lease claimed';end if;
 old_claim:=c;
 -- A committed new billing/entitlement revision invalidates the old lease.
 update public.effective_feature_entitlements set revision=2 where subject_user_id=teacher;
 update public.account_plans set revision=2 where subject_user_id=teacher;
 update public.billing_account_access set revision=2,account_plan_revision=2,entitlement_revision=2 where subject_user_id=teacher;
 result:=public.repolight_provision_outbox_v1('finish',old_claim-'attempt'||jsonb_build_object('outcome','ready'));
 if (result->>'acknowledged')::boolean then raise exception 'Stale revision acknowledged';end if;
 -- A delayed recovery snapshot cannot replace a newer committed revision.
 perform private.enqueue_repolight_provision_v1(teacher,'[1, 1, 1]');
 if (select source_revision from private.repolight_provision_outbox where teacher_id=teacher)<>'[2, 2, 2]' then raise exception 'Old recovery snapshot replaced new hint';end if;
 c:=public.repolight_provision_outbox_v1('claim',jsonb_build_object('teacherId',teacher));
 if (c->>'attempt')::int<>1 then raise exception 'New revision did not restart bounded work';end if;
 -- Process death retains uncertain work; expiry reclaims with a different token.
 update private.repolight_provision_outbox set lease_expires_at=clock_timestamp()-interval '1 second' where teacher_id=teacher;
 old_claim:=c;
 c:=public.repolight_provision_outbox_v1('claim',jsonb_build_object('teacherId',teacher));
 if (c->>'attempt')::int<>2 or c->>'leaseToken'=old_claim->>'leaseToken' then raise exception 'Killed lease recovery failed';end if;
 result:=public.repolight_provision_outbox_v1('finish',old_claim-'attempt'||jsonb_build_object('outcome','ready'));
 if (result->>'acknowledged')::boolean then raise exception 'Reclaimed lease acknowledged';end if;
 perform public.repolight_provision_outbox_v1('finish',c-'attempt'||jsonb_build_object('outcome','retry','errorCode','repolight_managed_timeout'));
 update private.repolight_provision_outbox set next_attempt_at=clock_timestamp()-interval '1 second' where teacher_id=teacher;
 c:=public.repolight_provision_outbox_v1('claim',jsonb_build_object('teacherId',teacher));
 if (c->>'attempt')::int<>3 then raise exception 'Third retry was not claimed';end if;
 perform public.repolight_provision_outbox_v1('finish',c-'attempt'||jsonb_build_object('outcome','retry','errorCode','repolight_managed_timeout'));
 if (select state from private.repolight_provision_outbox where teacher_id=teacher)<>'pending'
 or (select retry_round from private.repolight_provision_outbox where teacher_id=teacher)<>1
 or (select attempts from private.repolight_provision_outbox where teacher_id=teacher)<>0
 or (select next_attempt_at from private.repolight_provision_outbox where teacher_id=teacher)<clock_timestamp()+interval '59 minutes'
 or public.repolight_provision_outbox_v1('claim',jsonb_build_object('teacherId',teacher)) is not null then raise exception 'Transient burst did not enter bounded cooldown';end if;
 -- Replays cannot reset the same revision's durable cooldown.
 update public.billing_account_access set updated_at=clock_timestamp() where subject_user_id=teacher;
 if (select retry_round from private.repolight_provision_outbox where teacher_id=teacher)<>1 or public.repolight_provision_outbox_v1('claim',jsonb_build_object('teacherId',teacher)) is not null then raise exception 'Replay reset transient cooldown';end if;
 update public.effective_feature_entitlements set revision=3 where subject_user_id=teacher;
 update public.account_plans set revision=3 where subject_user_id=teacher;
 update public.billing_account_access set revision=3,account_plan_revision=3,entitlement_revision=3 where subject_user_id=teacher;
 c:=public.repolight_provision_outbox_v1('claim',jsonb_build_object('teacherId',teacher));
 perform public.repolight_provision_outbox_v1('finish',c-'attempt'||jsonb_build_object('outcome','ineligible','errorCode','repolight_managed_ineligible'));
 if public.repolight_provision_outbox_v1('claim',jsonb_build_object('teacherId',teacher)) is not null then raise exception 'Ineligible current revision retried';end if;
 update private.repolight_settings set billing_access_enabled=true where singleton;
 c:=public.repolight_provision_outbox_v1('claim',jsonb_build_object('teacherId',teacher));
 if c is null or (c->>'attempt')::int<>1 then raise exception 'Access gate activation lost retroactive eligibility';end if;
 perform public.repolight_provision_outbox_v1('finish',c-'attempt'||jsonb_build_object('outcome','ineligible'));
 update private.stripe_billing_settings set sandbox_enabled=true where singleton;
 c:=public.repolight_provision_outbox_v1('claim',jsonb_build_object('teacherId',teacher));
 if c is null or (c->>'attempt')::int<>1 then raise exception 'Billing gate activation lost retroactive eligibility';end if;
 perform public.repolight_provision_outbox_v1('finish',c-'attempt'||jsonb_build_object('outcome','ready'));
 update private.repolight_provision_outbox set state='pending',attempts=0 where teacher_id=teacher;
 c:=public.repolight_provision_outbox_v1('claim',jsonb_build_object('teacherId',teacher));
 -- A ready row's future retry timestamp is irrelevant once explicitly seeded due.
 if c is null then
  update private.repolight_provision_outbox set next_attempt_at=clock_timestamp()-interval '1 second' where teacher_id=teacher;
  c:=public.repolight_provision_outbox_v1('claim',jsonb_build_object('teacherId',teacher));
 end if;
 perform public.repolight_provision_outbox_v1('finish',c-'attempt'||jsonb_build_object('outcome','failed','errorCode','repolight_managed_invalid_storage'));
 if public.repolight_provision_outbox_v1('claim',jsonb_build_object('teacherId',teacher)) is not null
 or (select state from private.repolight_provision_outbox where teacher_id=teacher)<>'failed' then raise exception 'Nonretryable failure was automatically revived';end if;
 -- Transaction rollback cannot lose billing success or emit phantom work.
 begin
  update public.effective_feature_entitlements set revision=4 where subject_user_id=teacher;
 update public.account_plans set revision=4 where subject_user_id=teacher;
 update public.billing_account_access set revision=4,account_plan_revision=4,entitlement_revision=4 where subject_user_id=teacher;
  raise exception using errcode='P2999',message='intentional rollback';
 exception when sqlstate 'P2999' then null;end;
 if (select source_revision from private.repolight_provision_outbox where teacher_id=teacher)<>'[3, 3, 3]' then raise exception 'Rolled back transaction emitted work';end if;
 -- Queue metadata follows account lifecycle; registry credentials remain in297.
 delete from public.billing_account_access where subject_user_id=teacher;
 delete from public.effective_feature_entitlements where subject_user_id=teacher;
 delete from public.account_plans where subject_user_id=teacher;
 delete from public.users where id=teacher;
 if exists(select 1 from private.repolight_provision_outbox where teacher_id=teacher) then raise exception 'Removed account retained queue metadata';end if;
end $proof$;
do $bulk$
declare i integer; actor uuid; c jsonb; epoch_at bigint;
begin
 update private.repolight_settings set managed_provisioning_enabled=true where singleton;
 select epoch into epoch_at from private.repolight_provision_control where singleton;
 for i in 1..40 loop
  actor:=('f298b000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
  insert into public.users(id,role) values(actor,'student');
  insert into private.repolight_provision_outbox(teacher_id,source_revision,eligibility_epoch,state) values(actor,'[0,1,1]',epoch_at,'ineligible');
 end loop;
 update private.repolight_settings set legacy_plan_access_enabled=true where singleton;
 if (select count(*) from private.repolight_provision_outbox where state='ineligible')<>40 then raise exception 'Gate change performed unbounded row reset';end if;
 c:=public.repolight_provision_outbox_v1('claim');
 if (select count(*) from private.repolight_provision_outbox where state='ineligible')<>15 then raise exception 'Denial repair exceeded25';end if;
 delete from private.repolight_provision_outbox;
 for i in 1..40 loop
  actor:=('f298b000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
  insert into private.repolight_provision_outbox(teacher_id,source_revision,eligibility_epoch,state,attempts,lease_token,lease_expires_at)
   values(actor,'[0,1,1]',epoch_at,'processing',3,gen_random_uuid(),clock_timestamp()-interval '1 second');
 end loop;
 c:=public.repolight_provision_outbox_v1('claim');
 if c is not null or (select count(*) from private.repolight_provision_outbox where state='pending' and attempts=0 and retry_round=1 and next_attempt_at>clock_timestamp()+interval '59 minutes')<>25
 or (select count(*) from private.repolight_provision_outbox where state='processing')<>15 then raise exception 'Exhaustion repair exceeded25';end if;
 actor:='f298b000-0000-4000-8000-000000000001';
 update private.repolight_provision_outbox set state='processing',attempts=3,retry_round=6,
  lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()-interval '1 second' where teacher_id=actor;
 c:=public.repolight_provision_outbox_v1('claim',jsonb_build_object('teacherId',actor));
 if c is not null or not exists(select 1 from private.repolight_provision_outbox where teacher_id=actor
  and state='pending' and attempts=0 and retry_round=6 and next_attempt_at>clock_timestamp()+interval '23 hours 59 minutes'
  and next_attempt_at<=clock_timestamp()+interval '24 hours') then raise exception 'Long outage retry cap did not saturate';end if;
 perform private.enqueue_repolight_provision_v1(actor,'[0,2,2]');
 if not exists(select 1 from private.repolight_provision_outbox where teacher_id=actor and state='pending' and attempts=0 and retry_round=0
  and source_revision='[0,2,2]' and next_attempt_at<=clock_timestamp()) then raise exception 'New revision failed to reset cooldown';end if;
end $bulk$;
rollback;
