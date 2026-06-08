-- 0007_retention_purge.sql
-- Rolling retention so the database stays within the Supabase free tier (500MB).
-- Deletes operational/time-series rows older than the retention window (default
-- 4 months), child tables first to respect foreign keys. Config/master tables
-- (employees, tags, employee_tags, message_templates, schedule_lab_entries,
-- report_slot_policies) are intentionally left untouched.

create or replace function public.purge_old_operational_data(retention interval default interval '4 months')
returns table(table_name text, deleted bigint)
language plpgsql
as $$
declare
  cutoff timestamptz := now() - retention;
  n bigint;
begin
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

-- Schedule a daily rolling purge (02:00 Asia/Dhaka = 20:00 UTC). Re-running this
-- cron.schedule call updates the existing job in place.
select cron.schedule(
  'cf_purge_old_data',
  '0 20 * * *',
  $$ select public.purge_old_operational_data(interval '4 months'); $$
);
