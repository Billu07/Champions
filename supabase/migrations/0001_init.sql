-- 0001_init.sql
create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  designation text,
  department text,
  branch text,
  whatsapp_number_raw text not null,
  whatsapp_e164 text not null unique,
  tracking_enabled boolean not null default false,
  is_active boolean not null default true,
  status text not null default 'Active',
  aliases text[] not null default '{}',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_employees_updated_at
before update on public.employees
for each row
execute function public.set_updated_at();

create table if not exists public.tags (
  id uuid not null default gen_random_uuid(),
  key text primary key,
  label text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.employee_tags (
  employee_id uuid not null references public.employees(id) on delete cascade,
  tag_key text not null references public.tags(key) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (employee_id, tag_key)
);

create table if not exists public.message_templates (
  id uuid primary key default gen_random_uuid(),
  slot_key text not null check (slot_key in ('morning','noon','afternoon','evening')),
  template_name text not null,
  language_code text not null default 'en',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (slot_key, template_name)
);

create trigger trg_templates_updated_at
before update on public.message_templates
for each row
execute function public.set_updated_at();

create table if not exists public.message_events (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id) on delete set null,
  direction text not null check (direction in ('inbound','outbound')),
  category text not null,
  slot_key text check (slot_key in ('morning','noon','afternoon','evening')),
  tracking_date date,
  whatsapp_message_id text,
  message_text text,
  location_lat numeric,
  location_lng numeric,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_message_events_employee_date
  on public.message_events (employee_id, tracking_date, occurred_at);

create index if not exists idx_message_events_wa_message_id
  on public.message_events (whatsapp_message_id);

create table if not exists public.slot_responses (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  tracking_date date not null,
  slot_key text not null check (slot_key in ('morning','noon','afternoon','evening')),
  merged_text text,
  reply_count integer not null default 0,
  is_missing boolean not null default false,
  first_reply_at timestamptz,
  last_reply_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, tracking_date, slot_key)
);

create trigger trg_slot_responses_updated_at
before update on public.slot_responses
for each row
execute function public.set_updated_at();

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('individual_daily','team_daily','team_weekly')),
  report_date date not null,
  employee_id uuid references public.employees(id) on delete set null,
  title text not null,
  narrative text not null,
  metrics jsonb not null default '{}'::jsonb,
  model_name text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_reports_kind_date
  on public.reports (kind, report_date desc);

create table if not exists public.broadcast_campaigns (
  id uuid primary key default gen_random_uuid(),
  creator_type text not null,
  original_message text not null,
  final_message text not null,
  audience_type text not null,
  recipient_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.broadcast_deliveries (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.broadcast_campaigns(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  whatsapp_message_id text,
  status text not null check (status in ('sent','failed')),
  failure_reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_broadcast_deliveries_campaign
  on public.broadcast_deliveries (campaign_id);

create table if not exists public.mention_resolution_audit (
  id uuid primary key default gen_random_uuid(),
  message_body text not null,
  extracted_names text[] not null default '{}',
  resolved_employee_ids uuid[] not null default '{}',
  unresolved_names text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.job_runs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  job_key text not null unique,
  status text not null default 'running' check (status in ('running','success','failed')),
  note text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

insert into public.tags (key, label)
values
  ('sales_field', 'Sales Field'),
  ('head_office', 'Head Office'),
  ('drivers', 'Drivers'),
  ('transport_manager', 'Transport Manager')
on conflict (key) do update set label = excluded.label;

insert into public.message_templates (slot_key, template_name, language_code, is_active)
values
  ('morning', 'morning', 'en', true),
  ('noon', 'location_update', 'en', true),
  ('afternoon', 'afternoon_progress', 'en', true),
  ('evening', 'evening_report', 'en', true)
on conflict (slot_key, template_name) do update
set language_code = excluded.language_code,
    is_active = excluded.is_active,
    updated_at = now();
