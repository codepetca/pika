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
rollback;
