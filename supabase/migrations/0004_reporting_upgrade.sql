-- 0004_reporting_upgrade.sql
alter table public.reports
  drop constraint if exists reports_kind_check;

alter table public.reports
  add constraint reports_kind_check
  check (kind in ('individual_daily', 'team_daily', 'team_weekly', 'team_monthly'));

create index if not exists idx_slot_responses_date_slot_employee
  on public.slot_responses (tracking_date, slot_key, employee_id);

create index if not exists idx_reports_date_created
  on public.reports (report_date desc, created_at desc);
