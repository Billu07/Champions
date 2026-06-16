-- 0009_go_live_reset.sql
-- ONE-OFF go-live reset. Clears all transactional/test data accumulated during
-- development so the team starts live with a clean slate, while PRESERVING the
-- roster and all configuration.
--
-- WIPED (operational/time-series):
--   reports, slot_responses, message_events,
--   broadcast_delivery_events, broadcast_deliveries, broadcast_campaigns,
--   scheduled_deliveries, mention_resolution_audit, job_runs
--
-- PRESERVED (master/config — intentionally NOT touched):
--   employees, tags, employee_tags, message_templates, schedule_lab_entries
--
-- Run this ONCE, after final testing and immediately before go-live.
-- TRUNCATE resets the tables fully and is safe here because none of the
-- preserved tables reference these transactional tables.

truncate table
  public.reports,
  public.slot_responses,
  public.message_events,
  public.broadcast_delivery_events,
  public.broadcast_deliveries,
  public.broadcast_campaigns,
  public.scheduled_deliveries,
  public.mention_resolution_audit,
  public.job_runs
restart identity cascade;
