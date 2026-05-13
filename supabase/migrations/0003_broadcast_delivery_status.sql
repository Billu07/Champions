-- 0003_broadcast_delivery_status.sql
alter table public.broadcast_deliveries
  add column if not exists last_status_at timestamptz,
  add column if not exists status_payload jsonb not null default '{}'::jsonb;

alter table public.broadcast_deliveries
  drop constraint if exists broadcast_deliveries_status_check;

alter table public.broadcast_deliveries
  add constraint broadcast_deliveries_status_check
  check (status in ('accepted', 'sent', 'delivered', 'read', 'failed'));

create index if not exists idx_broadcast_deliveries_message_id
  on public.broadcast_deliveries (whatsapp_message_id);

create table if not exists public.broadcast_delivery_events (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid references public.broadcast_deliveries(id) on delete cascade,
  campaign_id uuid references public.broadcast_campaigns(id) on delete set null,
  employee_id uuid references public.employees(id) on delete set null,
  whatsapp_message_id text not null,
  status text not null check (status in ('accepted', 'sent', 'delivered', 'read', 'failed')),
  failure_reason text,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_broadcast_delivery_events_message
  on public.broadcast_delivery_events (whatsapp_message_id, occurred_at desc);

create index if not exists idx_broadcast_delivery_events_campaign
  on public.broadcast_delivery_events (campaign_id, occurred_at desc);
