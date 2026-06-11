-- 0008_scheduled_deliveries.sql
-- Per-recipient delivery tracking for scheduled messages, mirroring
-- broadcast_deliveries. Lets us see delivered vs accepted-but-dropped per slot,
-- so a template recategorization (utility -> marketing cap) is caught immediately
-- instead of being silent.

create table if not exists public.scheduled_deliveries (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id) on delete set null,
  slot_key text,
  tracking_date date,
  template_name text,
  whatsapp_message_id text,
  status text not null default 'accepted' check (status in ('accepted', 'sent', 'delivered', 'read', 'failed')),
  failure_reason text,
  last_status_at timestamptz,
  status_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_scheduled_deliveries_message_id
  on public.scheduled_deliveries (whatsapp_message_id);
create index if not exists idx_scheduled_deliveries_date_slot
  on public.scheduled_deliveries (tracking_date, slot_key);

-- Keep the retention purge covering this new table too.
create or replace function public.purge_old_operational_data(retention interval default interval '4 months')
returns table(table_name text, deleted bigint)
language plpgsql
as $$
declare
  cutoff timestamptz := now() - retention;
  n bigint;
begin
  delete from public.scheduled_deliveries where created_at < cutoff;
  get diagnostics n = row_count; table_name := 'scheduled_deliveries'; deleted := n; return next;

  delete from public.broadcast_delivery_events where created_at < cutoff;
  get diagnostics n = row_count; table_name := 'broadcast_delivery_events'; deleted := n; return next;

  delete from public.broadcast_deliveries where created_at < cutoff;
  get diagnostics n = row_count; table_name := 'broadcast_deliveries'; deleted := n; return next;

  delete from public.broadcast_campaigns where created_at < cutoff;
  get diagnostics n = row_count; table_name := 'broadcast_campaigns'; deleted := n; return next;

  delete from public.mention_resolution_audit where created_at < cutoff;
  get diagnostics n = row_count; table_name := 'mention_resolution_audit'; deleted := n; return next;

  delete from public.reports where created_at < cutoff;
  get diagnostics n = row_count; table_name := 'reports'; deleted := n; return next;

  delete from public.slot_responses where created_at < cutoff;
  get diagnostics n = row_count; table_name := 'slot_responses'; deleted := n; return next;

  delete from public.message_events where created_at < cutoff;
  get diagnostics n = row_count; table_name := 'message_events'; deleted := n; return next;

  delete from public.job_runs where created_at < cutoff;
  get diagnostics n = row_count; table_name := 'job_runs'; deleted := n; return next;
end;
$$;
