-- DataPilot foundation migration.
-- Run this in the Supabase SQL editor with a privileged project role.
-- The browser must only receive the publishable/anon key.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'analyst', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'analyst', 'viewer')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  invited_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.data_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('upload', 'postgresql', 'supabase')),
  name text not null,
  connection_secret_ref text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.datasets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  data_source_id uuid references public.data_sources(id) on delete set null,
  name text not null,
  description text,
  source_table text,
  status text not null default 'ready' check (status in ('uploading', 'profiling', 'ready', 'failed', 'deleted')),
  current_version_id uuid,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.dataset_versions (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references public.datasets(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  row_count bigint not null default 0 check (row_count >= 0),
  column_count integer not null default 0 check (column_count >= 0),
  content_hash text,
  source_file_path text,
  profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (dataset_id, version_number)
);

alter table public.datasets
  drop constraint if exists datasets_current_version_fk;
alter table public.datasets
  add constraint datasets_current_version_fk
  foreign key (current_version_id) references public.dataset_versions(id) on delete set null;

create table if not exists public.dataset_columns (
  id uuid primary key default gen_random_uuid(),
  dataset_version_id uuid not null references public.dataset_versions(id) on delete cascade,
  position integer not null check (position >= 0),
  display_name text not null,
  safe_name text not null,
  inferred_type text not null check (inferred_type in ('text', 'integer', 'decimal', 'boolean', 'date', 'datetime', 'unknown')),
  nullable boolean not null default true,
  semantic_type text,
  unique (dataset_version_id, safe_name),
  unique (dataset_version_id, position)
);

create table if not exists public.dataset_rows (
  id bigint generated always as identity primary key,
  dataset_version_id uuid not null references public.dataset_versions(id) on delete cascade,
  row_number bigint not null check (row_number > 0),
  values jsonb not null,
  row_hash text,
  created_at timestamptz not null default now(),
  unique (dataset_version_id, row_number)
);

create table if not exists public.ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  dataset_id uuid references public.datasets(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  error_code text,
  error_message text,
  progress numeric(5,2) not null default 0 check (progress between 0 and 100),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.quality_reports (
  id uuid primary key default gen_random_uuid(),
  dataset_version_id uuid not null references public.dataset_versions(id) on delete cascade,
  status text not null check (status in ('pass', 'warn', 'fail')),
  score integer check (score between 0 and 100),
  checks jsonb not null default '[]'::jsonb,
  profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.query_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  dataset_id uuid references public.datasets(id) on delete set null,
  dataset_version_id uuid references public.dataset_versions(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete restrict,
  question text not null check (length(trim(question)) between 1 and 2000),
  clarification_context jsonb not null default '{}'::jsonb,
  resolved_time_range jsonb,
  sql text,
  parameters jsonb,
  status text not null check (status in ('answered', 'answered_with_warnings', 'needs_clarification', 'insufficient_data', 'blocked', 'failed')),
  answer text,
  result_schema jsonb,
  result_rows jsonb,
  coverage jsonb,
  assumptions jsonb not null default '[]'::jsonb,
  confidence jsonb,
  model_provider text,
  model_id text,
  prompt_version text,
  error_code text,
  error_message text,
  duration_ms integer,
  created_at timestamptz not null default now()
);

create table if not exists public.validation_checks (
  id uuid primary key default gen_random_uuid(),
  query_run_id uuid not null references public.query_runs(id) on delete cascade,
  code text not null,
  severity text not null check (severity in ('info', 'warning', 'error')),
  status text not null check (status in ('pass', 'warn', 'fail', 'not_evaluated')),
  scope text,
  checked_count bigint,
  affected_count bigint,
  columns jsonb not null default '[]'::jsonb,
  examples jsonb not null default '[]'::jsonb,
  explanation text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  resource_type text,
  resource_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.usage_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  units numeric not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.plugin_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_type text not null check (client_type in ('excel', 'google_sheets')),
  nonce_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists memberships_user_idx on public.memberships(user_id);
create index if not exists datasets_org_idx on public.datasets(organization_id) where deleted_at is null;
create index if not exists dataset_versions_dataset_idx on public.dataset_versions(dataset_id);
create index if not exists dataset_rows_version_idx on public.dataset_rows(dataset_version_id, row_number);
create index if not exists query_runs_org_created_idx on public.query_runs(organization_id, created_at desc);
create index if not exists audit_events_org_created_idx on public.audit_events(organization_id, created_at desc);

create or replace function public.is_org_member(target_org uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = target_org and m.user_id = auth.uid()
  );
$$;

create or replace function public.org_role(target_org uuid)
returns text
language sql
stable
security definer set search_path = public
as $$
  select m.role from public.memberships m
  where m.organization_id = target_org and m.user_id = auth.uid()
  limit 1;
$$;

revoke all on function public.is_org_member(uuid) from public;
grant execute on function public.is_org_member(uuid) to authenticated;
revoke all on function public.org_role(uuid) from public;
grant execute on function public.org_role(uuid) to authenticated;

create or replace function public.create_organization(p_name text)
returns public.organizations
language plpgsql
security definer set search_path = public
as $$
declare
  created public.organizations;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if p_name is null or length(trim(p_name)) not between 1 and 120 then
    raise exception 'organization name must be between 1 and 120 characters';
  end if;
  insert into public.organizations (name, created_by)
  values (trim(p_name), auth.uid())
  returning * into created;
  insert into public.memberships (organization_id, user_id, role)
  values (created.id, auth.uid(), 'owner');
  return created;
end;
$$;

revoke all on function public.create_organization(text) from public;
grant execute on function public.create_organization(text) to authenticated;

create or replace function public.touch_profile()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.touch_profile();

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.data_sources enable row level security;
alter table public.datasets enable row level security;
alter table public.dataset_versions enable row level security;
alter table public.dataset_columns enable row level security;
alter table public.dataset_rows enable row level security;
alter table public.ingestion_jobs enable row level security;
alter table public.quality_reports enable row level security;
alter table public.query_runs enable row level security;
alter table public.validation_checks enable row level security;
alter table public.audit_events enable row level security;
alter table public.usage_events enable row level security;
alter table public.plugin_sessions enable row level security;

drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles for select using (id = auth.uid());
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists organizations_member_select on public.organizations;
create policy organizations_member_select on public.organizations for select using (public.is_org_member(id));
drop policy if exists organizations_owner_insert on public.organizations;
create policy organizations_owner_insert on public.organizations for insert with check (created_by = auth.uid());
drop policy if exists organizations_admin_update on public.organizations;
create policy organizations_admin_update on public.organizations for update using (public.org_role(id) in ('owner', 'admin')) with check (public.org_role(id) in ('owner', 'admin'));

drop policy if exists memberships_member_select on public.memberships;
create policy memberships_member_select on public.memberships for select using (public.is_org_member(organization_id));
drop policy if exists memberships_owner_insert on public.memberships;
create policy memberships_owner_insert on public.memberships for insert with check (public.org_role(organization_id) in ('owner', 'admin'));
drop policy if exists memberships_admin_update on public.memberships;
create policy memberships_admin_update on public.memberships for update using (public.org_role(organization_id) in ('owner', 'admin')) with check (public.org_role(organization_id) in ('owner', 'admin'));

-- Generic organization-scoped policies. The application still performs explicit
-- authorization checks; RLS is the second boundary.
drop policy if exists data_sources_member_all on public.data_sources;
create policy data_sources_member_all on public.data_sources for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id) and (created_by = auth.uid() or public.org_role(organization_id) in ('owner', 'admin', 'analyst')));
drop policy if exists datasets_member_all on public.datasets;
create policy datasets_member_all on public.datasets for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id) and (created_by = auth.uid() or public.org_role(organization_id) in ('owner', 'admin', 'analyst')));
drop policy if exists ingestion_jobs_member_all on public.ingestion_jobs;
create policy ingestion_jobs_member_all on public.ingestion_jobs for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
drop policy if exists query_runs_member_all on public.query_runs;
create policy query_runs_member_all on public.query_runs for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id) and user_id = auth.uid());
drop policy if exists usage_events_member_select on public.usage_events;
create policy usage_events_member_select on public.usage_events for select using (public.is_org_member(organization_id));
drop policy if exists audit_events_member_select on public.audit_events;
create policy audit_events_member_select on public.audit_events for select using (public.is_org_member(organization_id));
drop policy if exists plugin_sessions_owner_all on public.plugin_sessions;
create policy plugin_sessions_owner_all on public.plugin_sessions for all using (user_id = auth.uid() and public.is_org_member(organization_id)) with check (user_id = auth.uid() and public.is_org_member(organization_id));

drop policy if exists dataset_versions_member_all on public.dataset_versions;
create policy dataset_versions_member_all on public.dataset_versions for all
using (exists (select 1 from public.datasets d where d.id = dataset_id and public.is_org_member(d.organization_id)))
with check (exists (select 1 from public.datasets d where d.id = dataset_id and public.is_org_member(d.organization_id)));
drop policy if exists dataset_columns_member_all on public.dataset_columns;
create policy dataset_columns_member_all on public.dataset_columns for all
using (exists (select 1 from public.dataset_versions v join public.datasets d on d.id = v.dataset_id where v.id = dataset_version_id and public.is_org_member(d.organization_id)))
with check (exists (select 1 from public.dataset_versions v join public.datasets d on d.id = v.dataset_id where v.id = dataset_version_id and public.is_org_member(d.organization_id)));
drop policy if exists dataset_rows_member_all on public.dataset_rows;
create policy dataset_rows_member_all on public.dataset_rows for all
using (exists (select 1 from public.dataset_versions v join public.datasets d on d.id = v.dataset_id where v.id = dataset_version_id and public.is_org_member(d.organization_id)))
with check (exists (select 1 from public.dataset_versions v join public.datasets d on d.id = v.dataset_id where v.id = dataset_version_id and public.is_org_member(d.organization_id)));
drop policy if exists quality_reports_member_all on public.quality_reports;
create policy quality_reports_member_all on public.quality_reports for all
using (exists (select 1 from public.dataset_versions v join public.datasets d on d.id = v.dataset_id where v.id = dataset_version_id and public.is_org_member(d.organization_id)))
with check (exists (select 1 from public.dataset_versions v join public.datasets d on d.id = v.dataset_id where v.id = dataset_version_id and public.is_org_member(d.organization_id)));
drop policy if exists validation_checks_member_all on public.validation_checks;
create policy validation_checks_member_all on public.validation_checks for all
using (exists (select 1 from public.query_runs q where q.id = query_run_id and public.is_org_member(q.organization_id)))
with check (exists (select 1 from public.query_runs q where q.id = query_run_id and public.is_org_member(q.organization_id)));

-- Safe server-side preview helper. It returns bounded rows only from a version
-- the current user can access. It does not execute arbitrary SQL.
create or replace function public.datapilot_preview_dataset(p_dataset_id uuid, p_limit integer default 50)
returns jsonb
language plpgsql
stable
security invoker
as $$
declare
  result jsonb;
begin
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'limit must be between 1 and 200';
  end if;
  if not exists (select 1 from public.datasets d where d.id = p_dataset_id and public.is_org_member(d.organization_id) and d.deleted_at is null) then
    raise exception 'dataset not found';
  end if;
  select jsonb_build_object(
    'dataset_id', p_dataset_id,
    'columns', coalesce((select jsonb_agg(to_jsonb(c) order by c.position) from public.dataset_columns c join public.datasets d on d.current_version_id = c.dataset_version_id where d.id = p_dataset_id), '[]'::jsonb),
    'rows', coalesce((select jsonb_agg(r.values order by r.row_number) from public.dataset_rows r join public.datasets d on d.current_version_id = r.dataset_version_id where d.id = p_dataset_id limit p_limit), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.datapilot_preview_dataset(uuid, integer) from public;
grant execute on function public.datapilot_preview_dataset(uuid, integer) to authenticated;

-- New accounts receive a profile. Organization creation is intentionally kept
-- in the private API so a single transaction can create owner membership too.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();
