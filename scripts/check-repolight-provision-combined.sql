-- Actual296/297/298 contracts in the owned full-schema offline replay.
begin;
set local lock_timeout='3s';set local statement_timeout='30s';
do $proof$
declare actor uuid:='f2980000-0000-4000-8000-000000000001'; c jsonb; pending jsonb; ready jsonb; rotation jsonb; candidate jsonb; rev bigint; p text;
begin
 if exists(select 1 from private.repolight_settings where managed_provisioning_enabled) then raise exception 'Managed gate unexpectedly active';end if;
 if has_table_privilege('service_role','private.repolight_provision_control','UPDATE')
 or has_function_privilege('service_role','private.enqueue_repolight_provision_v1(uuid,text)','EXECUTE')
 or has_function_privilege('authenticated','public.repolight_provision_outbox_v1(text,jsonb)','EXECUTE') then raise exception 'Provisioning ACL drift';end if;
 insert into public.users(id,email,role) values(actor,'legacy-repolight298@example.invalid','student');
 perform public.set_account_plan_v1(gen_random_uuid(),actor,'plus','test:provision298','fixture',coalesce((select revision from public.account_plans where subject_user_id=actor),0));
 update private.repolight_settings set managed_provisioning_enabled=true where singleton;
 if public.repolight_provision_outbox_v1('claim',jsonb_build_object('teacherId',actor)) is not null then raise exception 'Disabled legacy gate discovered account';end if;
 update private.repolight_settings set legacy_plan_access_enabled=true where singleton;
 c:=public.repolight_provision_outbox_v1('claim',jsonb_build_object('teacherId',actor));
 if c->>'teacherId' is distinct from actor::text or public.get_repolight_analysis_access_v1(actor)->>'allowed'<>'true' then raise exception 'Eligible role-neutral legacy account not discovered';end if;
 candidate:=jsonb_build_object('teacherId',actor,'tenantRef','opaque298','operationRef',gen_random_uuid(),'keyId',gen_random_uuid(),'secretHash',repeat('a',64),'connectionRef','connection298','apiOrigin','https://reports.example.test','installationRef','installation298','encryptedKey',jsonb_build_object('ciphertext','encrypted'),'operationKind','provision','expectedKeyId',null,'state','pending','workspaceRef',null);
 -- Disable after claim prevents both initial prepare and resumed authorization.
 update private.repolight_settings set managed_provisioning_enabled=false where singleton;
 begin perform public.prepare_repolight_managed_connection_v1(actor,candidate);raise exception 'Disabled claimed provision prepared';exception when insufficient_privilege then null;end;
 update private.repolight_settings set managed_provisioning_enabled=true where singleton;
 perform public.repolight_provision_outbox_v1('finish',c-'attempt'||jsonb_build_object('outcome','ineligible'));
 if (select state from private.repolight_provision_outbox where teacher_id=actor)<>'pending' then raise exception 'Late denial stranded new gate epoch';end if;
 c:=public.repolight_provision_outbox_v1('claim',jsonb_build_object('teacherId',actor));
 pending:=public.prepare_repolight_managed_connection_v1(actor,candidate);
 update private.repolight_settings set managed_provisioning_enabled=false where singleton;
 begin perform public.prepare_repolight_managed_connection_v1(actor,pending);raise exception 'Disabled resume authorized';exception when insufficient_privilege then null;end;
 begin perform public.activate_repolight_managed_connection_v1(actor,pending,'workspace298');raise exception 'Disabled provision activated';exception when insufficient_privilege then null;end;
 if public.read_repolight_managed_connection_v1(actor) is distinct from pending then raise exception 'Disabled activation lost pending key';end if;
 update private.repolight_settings set managed_provisioning_enabled=true where singleton;
 ready:=public.activate_repolight_managed_connection_v1(actor,pending,'workspace298');
 perform public.repolight_provision_outbox_v1('finish',c-'attempt'||jsonb_build_object('outcome','ready'));
 rotation:=ready||jsonb_build_object('operationKind','rotate','expectedKeyId',ready->>'keyId','operationRef',gen_random_uuid(),'keyId',gen_random_uuid(),'connectionRef','rotated298','state','pending');
 update private.repolight_settings set managed_provisioning_enabled=false,legacy_plan_access_enabled=false where singleton;
 rotation:=public.prepare_repolight_managed_rotation_v1(actor,rotation);
 ready:=public.activate_repolight_managed_connection_v1(actor,rotation,'workspace298');
 if ready->>'state'<>'ready' or public.read_repolight_managed_connection_v1(actor,'connection298')->>'state'<>'retired' then raise exception 'Disabled rotation recovery lost saved locator';end if;
 update private.repolight_settings set managed_provisioning_enabled=true,legacy_plan_access_enabled=true where singleton;
 foreach p in array array['free','basic','plus','pro'] loop
  select revision into rev from public.account_plans where subject_user_id=actor;
  perform public.set_account_plan_v1(gen_random_uuid(),actor,p,'test:provision298','fixture',rev);
  if not exists(select 1 from private.repolight_provision_outbox where teacher_id=actor and state='pending'
   and source_revision=private.repolight_provision_revision_v1(actor)) then raise exception 'Legacy plan change did not emit latest hint';end if;
  c:=public.repolight_provision_outbox_v1('claim',jsonb_build_object('teacherId',actor));
  if c is null then raise exception 'Legacy plan change hint was not claimable';end if;
  if (public.get_repolight_analysis_access_v1(actor)->>'allowed')::boolean is distinct from (p in('plus','pro')) then raise exception 'Legacy exact eligibility mismatch';end if;
  perform public.repolight_provision_outbox_v1('finish',c-'attempt'||jsonb_build_object('outcome',case when p in('plus','pro') then 'ready' else 'ineligible' end));
 end loop;
end $proof$;
do $retry$
declare actor uuid:='f2980000-0000-4000-8000-000000000002';c jsonb;candidate jsonb;pending jsonb;due timestamptz;fingerprint text;i integer;
begin
 insert into public.users(id,email,role) values(actor,'retry-repolight298@example.invalid','student');
 perform public.set_account_plan_v1(gen_random_uuid(),actor,'plus','test:provision298','fixture',coalesce((select revision from public.account_plans where subject_user_id=actor),0));
 candidate:=jsonb_build_object('teacherId',actor,'tenantRef','opaque298-retry','operationRef',gen_random_uuid(),'keyId',gen_random_uuid(),'secretHash',repeat('b',64),'connectionRef','connection298-retry','apiOrigin','https://reports.example.test','installationRef','installation298','encryptedKey',jsonb_build_object('ciphertext','encrypted'),'operationKind','provision','expectedKeyId',null,'state','pending','workspaceRef',null);
 fingerprint:=private.repolight_provision_revision_v1(actor);
 for i in 1..3 loop
  c:=public.repolight_provision_outbox_v1('claim',jsonb_build_object('teacherId',actor));
  if (c->>'attempt')::int<>i then raise exception 'Retry burst attempt differs';end if;
  pending:=public.prepare_repolight_managed_connection_v1(actor,candidate);
  if pending is distinct from candidate then raise exception 'Retry allocated another operation';end if;
  perform public.repolight_provision_outbox_v1('finish',c-'attempt'||jsonb_build_object('outcome','retry','errorCode','repolight_managed_timeout'));
  if i<3 then update private.repolight_provision_outbox set next_attempt_at=clock_timestamp()-interval '1 second' where teacher_id=actor;end if;
 end loop;
 select next_attempt_at into due from private.repolight_provision_outbox where teacher_id=actor;
 if due<clock_timestamp()+interval '59 minutes' or public.repolight_provision_outbox_v1('claim',jsonb_build_object('teacherId',actor)) is not null then raise exception 'Three transient failures lost cooldown';end if;
 -- Epoch changes and unchanged revision replays cannot bypass the cooldown.
 update private.repolight_settings set legacy_plan_access_enabled=false where singleton;
 update private.repolight_settings set legacy_plan_access_enabled=true where singleton;
 update public.account_plans set updated_at=clock_timestamp() where subject_user_id=actor;
 if public.repolight_provision_outbox_v1('claim',jsonb_build_object('teacherId',actor)) is not null
 or (select next_attempt_at from private.repolight_provision_outbox where teacher_id=actor) is distinct from due
 or (select source_revision from private.repolight_provision_outbox where teacher_id=actor) is distinct from fingerprint then raise exception 'Replay/epoch bypassed same-revision cooldown';end if;
 -- After the cooldown the same eligible revision automatically resumes its
 -- exact saved key and operation, without another plan event or owner action.
 update private.repolight_provision_outbox set next_attempt_at=clock_timestamp()-interval '1 second' where teacher_id=actor;
 c:=public.repolight_provision_outbox_v1('claim',jsonb_build_object('teacherId',actor));
 if (c->>'attempt')::int<>1 or public.prepare_repolight_managed_connection_v1(actor,candidate) is distinct from pending then raise exception 'Same revision did not recover automatically';end if;
 perform public.activate_repolight_managed_connection_v1(actor,pending,'workspace298-retry');
 perform public.repolight_provision_outbox_v1('finish',c-'attempt'||jsonb_build_object('outcome','ready'));
 -- Deadline remains authoritative on a later retry, independent of the queue.
 update public.effective_feature_entitlements set starts_at=clock_timestamp()-interval '1 day',expires_at=clock_timestamp()-interval '1 second' where subject_user_id=actor and feature_key='classrooms.create';
 begin perform public.prepare_repolight_managed_connection_v1(actor,candidate);raise exception 'Expired retry authorized provider work';exception when insufficient_privilege then null;end;
 if public.read_repolight_managed_connection_v1(actor)->>'state'<>'ready' then raise exception 'Expiry removed saved credentials';end if;
 -- Retry counters and schedules saturate instead of overflowing or hammering.
 for i in 0..6 loop
  if private.repolight_provision_retry_delay_v1(i)>interval '24 hours' or private.repolight_provision_retry_delay_v1(i)<interval '1 hour' then raise exception 'Retry delay outside bounded range';end if;
 end loop;
 if private.repolight_provision_retry_delay_v1(0)<>interval '1 hour' or private.repolight_provision_retry_delay_v1(6)<>interval '24 hours' then raise exception 'Retry delay endpoints differ';end if;
end $retry$;
rollback;
