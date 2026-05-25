-- Add structured assignment submission requirements and student artifacts.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'assignment-artifacts',
  'assignment-artifacts',
  false,
  10485760,
  array['image/png', 'image/jpeg', 'image/gif', 'image/webp']
)
on conflict (id) do nothing;

create table if not exists public.user_github_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  github_login text,
  commit_emails text[] not null default array[]::text[],
  validation_status text not null default 'unvalidated'
    check (validation_status in ('unvalidated', 'valid', 'invalid', 'inaccessible')),
  validation_message text,
  validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create table if not exists public.assignment_submission_requirements (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  type text not null check (type in ('repo_link', 'link', 'image')),
  label text not null,
  instructions text not null default '',
  required boolean not null default true,
  position integer not null default 0,
  validation_policy_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.assignment_submission_artifacts (
  id uuid primary key default gen_random_uuid(),
  assignment_doc_id uuid not null references public.assignment_docs (id) on delete cascade,
  requirement_id uuid not null references public.assignment_submission_requirements (id) on delete cascade,
  student_id uuid not null references public.users (id) on delete cascade,
  type text not null check (type in ('repo_link', 'link', 'image')),
  url text,
  storage_path text,
  metadata_json jsonb not null default '{}'::jsonb,
  validation_status text not null default 'missing'
    check (validation_status in ('missing', 'pending', 'valid', 'warning', 'invalid', 'inaccessible')),
  validation_message text,
  validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_doc_id, requirement_id),
  check (url is not null or storage_path is not null)
);

create index if not exists idx_assignment_submission_requirements_assignment_position
  on public.assignment_submission_requirements (assignment_id, position, created_at);

create index if not exists idx_assignment_submission_artifacts_requirement
  on public.assignment_submission_artifacts (requirement_id);

create index if not exists idx_assignment_submission_artifacts_student
  on public.assignment_submission_artifacts (student_id, updated_at desc);

create index if not exists idx_assignment_submission_artifacts_doc
  on public.assignment_submission_artifacts (assignment_doc_id);

create or replace function public.update_user_github_identities_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_user_github_identities_updated_at on public.user_github_identities;
create trigger update_user_github_identities_updated_at
  before update on public.user_github_identities
  for each row
  execute function public.update_user_github_identities_updated_at();

create or replace function public.update_assignment_submission_requirements_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_assignment_submission_requirements_updated_at on public.assignment_submission_requirements;
create trigger update_assignment_submission_requirements_updated_at
  before update on public.assignment_submission_requirements
  for each row
  execute function public.update_assignment_submission_requirements_updated_at();

create or replace function public.update_assignment_submission_artifacts_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_assignment_submission_artifacts_updated_at on public.assignment_submission_artifacts;
create trigger update_assignment_submission_artifacts_updated_at
  before update on public.assignment_submission_artifacts
  for each row
  execute function public.update_assignment_submission_artifacts_updated_at();

alter table public.user_github_identities enable row level security;
alter table public.assignment_submission_requirements enable row level security;
alter table public.assignment_submission_artifacts enable row level security;

grant select, insert, update, delete on public.user_github_identities to authenticated, service_role;
grant select, insert, update, delete on public.assignment_submission_requirements to authenticated, service_role;
grant select, insert, update, delete on public.assignment_submission_artifacts to authenticated, service_role;

drop policy if exists "Users can view their own GitHub identity" on public.user_github_identities;
create policy "Users can view their own GitHub identity"
  on public.user_github_identities for select
  using (auth.uid() is not null and user_id = auth.uid());

drop policy if exists "Users can create their own GitHub identity" on public.user_github_identities;
create policy "Users can create their own GitHub identity"
  on public.user_github_identities for insert
  with check (auth.uid() is not null and user_id = auth.uid());

drop policy if exists "Users can update their own GitHub identity" on public.user_github_identities;
create policy "Users can update their own GitHub identity"
  on public.user_github_identities for update
  using (auth.uid() is not null and user_id = auth.uid())
  with check (auth.uid() is not null and user_id = auth.uid());

drop policy if exists "Teachers can view assignment submission requirements" on public.assignment_submission_requirements;
create policy "Teachers can view assignment submission requirements"
  on public.assignment_submission_requirements for select
  using (
    exists (
      select 1
      from public.assignments
      join public.classrooms on classrooms.id = assignments.classroom_id
      where assignments.id = assignment_submission_requirements.assignment_id
        and classrooms.teacher_id = auth.uid()
    )
  );

drop policy if exists "Teachers can manage assignment submission requirements" on public.assignment_submission_requirements;
create policy "Teachers can manage assignment submission requirements"
  on public.assignment_submission_requirements for all
  using (
    exists (
      select 1
      from public.assignments
      join public.classrooms on classrooms.id = assignments.classroom_id
      where assignments.id = assignment_submission_requirements.assignment_id
        and classrooms.teacher_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.assignments
      join public.classrooms on classrooms.id = assignments.classroom_id
      where assignments.id = assignment_submission_requirements.assignment_id
        and classrooms.teacher_id = auth.uid()
    )
  );

drop policy if exists "Students can view enrolled assignment submission requirements" on public.assignment_submission_requirements;
create policy "Students can view enrolled assignment submission requirements"
  on public.assignment_submission_requirements for select
  using (
    exists (
      select 1
      from public.assignments
      join public.classroom_enrollments
        on classroom_enrollments.classroom_id = assignments.classroom_id
      where assignments.id = assignment_submission_requirements.assignment_id
        and classroom_enrollments.student_id = auth.uid()
    )
  );

drop policy if exists "Students can view their own submission artifacts" on public.assignment_submission_artifacts;
create policy "Students can view their own submission artifacts"
  on public.assignment_submission_artifacts for select
  using (auth.uid() is not null and student_id = auth.uid());

drop policy if exists "Students can create their own submission artifacts" on public.assignment_submission_artifacts;
create policy "Students can create their own submission artifacts"
  on public.assignment_submission_artifacts for insert
  with check (
    auth.uid() is not null
    and student_id = auth.uid()
    and exists (
      select 1
      from public.assignment_docs
      join public.assignment_submission_requirements
        on assignment_submission_requirements.assignment_id = assignment_docs.assignment_id
      where assignment_docs.id = assignment_submission_artifacts.assignment_doc_id
        and assignment_docs.student_id = auth.uid()
        and assignment_submission_requirements.id = assignment_submission_artifacts.requirement_id
        and assignment_submission_requirements.type = assignment_submission_artifacts.type
    )
  );

drop policy if exists "Students can update their own submission artifacts" on public.assignment_submission_artifacts;
create policy "Students can update their own submission artifacts"
  on public.assignment_submission_artifacts for update
  using (auth.uid() is not null and student_id = auth.uid())
  with check (
    auth.uid() is not null
    and student_id = auth.uid()
    and exists (
      select 1
      from public.assignment_docs
      join public.assignment_submission_requirements
        on assignment_submission_requirements.assignment_id = assignment_docs.assignment_id
      where assignment_docs.id = assignment_submission_artifacts.assignment_doc_id
        and assignment_docs.student_id = auth.uid()
        and assignment_submission_requirements.id = assignment_submission_artifacts.requirement_id
        and assignment_submission_requirements.type = assignment_submission_artifacts.type
    )
  );

drop policy if exists "Students can delete their own submission artifacts" on public.assignment_submission_artifacts;
create policy "Students can delete their own submission artifacts"
  on public.assignment_submission_artifacts for delete
  using (auth.uid() is not null and student_id = auth.uid());

drop policy if exists "Teachers can view assignment submission artifacts" on public.assignment_submission_artifacts;
create policy "Teachers can view assignment submission artifacts"
  on public.assignment_submission_artifacts for select
  using (
    exists (
      select 1
      from public.assignment_submission_requirements
      join public.assignments on assignments.id = assignment_submission_requirements.assignment_id
      join public.classrooms on classrooms.id = assignments.classroom_id
      where assignment_submission_requirements.id = assignment_submission_artifacts.requirement_id
        and classrooms.teacher_id = auth.uid()
    )
  );

drop policy if exists "Students can upload assignment artifact images" on storage.objects;
create policy "Students can upload assignment artifact images"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'assignment-artifacts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Students can view their own assignment artifact images" on storage.objects;
create policy "Students can view their own assignment artifact images"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'assignment-artifacts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Students can update their own assignment artifact images" on storage.objects;
create policy "Students can update their own assignment artifact images"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'assignment-artifacts'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'assignment-artifacts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Students can delete their own assignment artifact images" on storage.objects;
create policy "Students can delete their own assignment artifact images"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'assignment-artifacts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

comment on table public.assignment_submission_requirements is
  'Teacher-authored structured artifacts students must submit for an assignment.';

comment on table public.assignment_submission_artifacts is
  'Student-submitted structured artifacts that satisfy assignment requirements.';

comment on table public.user_github_identities is
  'Account-level GitHub identity used as the default identity for repo-link assignment artifacts.';
