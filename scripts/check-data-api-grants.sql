-- This contract is executed only inside the harness-owned disposable container.
begin;
do $$
begin
  if current_user <> 'postgres' or (select rolsuper from pg_roles where rolname = current_user) then
    raise exception 'Grant migration contract must run as restricted postgres';
  end if;
end;
$$;
do $$
declare
  object record;
  client text;
  privilege text;
begin
  for object in select c.oid, c.relkind, n.nspname, c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private') and c.relkind in ('r','p','v','m','f','S')
  loop
    foreach client in array array['anon', 'authenticated'] loop
      foreach privilege in array case when object.relkind = 'S'
        then array['SELECT','UPDATE','USAGE'] else array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] end
      loop
        if (case when object.relkind = 'S' then has_sequence_privilege(client, object.oid, privilege)
          else has_table_privilege(client, object.oid, privilege) end) then
          raise exception 'Client privilege leaked: %.% % %', object.nspname, object.relname, client, privilege;
        end if;
      end loop;
    end loop;
  end loop;
  -- Migration281 deliberately makes this transaction capability RPC-only.
  -- The additive grants must not reopen it, even through inherited privileges.
  if has_table_privilege('service_role', 'private.attendance_decommission_delete_capabilities',
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') then
    raise exception 'Direct server privilege leaked on retained attendance capability';
  end if;
end;
$$;
-- Fail closed for the supported postgres migration creator, including global defaults.
create table public.data_api_grants_postgres_probe (id bigint);
create sequence public.data_api_grants_postgres_sequence_probe;
do $$
declare
  target text;
  client text;
begin
  foreach target in array array['public.data_api_grants_postgres_probe'] loop
    foreach client in array array['anon','authenticated','service_role'] loop
      if has_table_privilege(client,target,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') then
        raise exception 'Future table inherits an automatic grant: % %', target, client;
      end if;
    end loop;
  end loop;
  foreach target in array array['public.data_api_grants_postgres_sequence_probe'] loop
    foreach client in array array['anon','authenticated','service_role'] loop
      if has_sequence_privilege(client,target,'SELECT,UPDATE,USAGE') then
        raise exception 'Future sequence inherits an automatic grant: % %', target, client;
      end if;
    end loop;
  end loop;
end;
$$;
rollback;
