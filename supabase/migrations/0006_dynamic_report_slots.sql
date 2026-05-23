-- 0006_dynamic_report_slots.sql
-- Make report slots fully dynamic (slug keys), and preserve weighted scoring.

alter table public.schedule_lab_entries
  add column if not exists report_weight numeric(6,2) not null default 1;

update public.schedule_lab_entries
set report_weight = case
  when report_slot_key = 'morning' then 0
  when report_slot_key = 'noon' then 1
  when report_slot_key = 'afternoon' then 2.5
  when report_slot_key = 'evening' then 3
  when report_slot_key is null then 0
  else coalesce(report_weight, 1)
end;

alter table public.schedule_lab_entries
  drop constraint if exists schedule_lab_entries_report_slot_key_check;

alter table public.message_events
  drop constraint if exists message_events_slot_key_check;

alter table public.slot_responses
  drop constraint if exists slot_responses_slot_key_check;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'schedule_lab_entries_report_weight_non_negative_check'
  ) then
    alter table public.schedule_lab_entries
      add constraint schedule_lab_entries_report_weight_non_negative_check
      check (report_weight >= 0);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'schedule_lab_entries_report_slot_key_format_check'
  ) then
    alter table public.schedule_lab_entries
      add constraint schedule_lab_entries_report_slot_key_format_check
      check (report_slot_key is null or report_slot_key ~ '^[a-z][a-z0-9_-]{1,39}$');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'message_events_slot_key_format_check'
  ) then
    alter table public.message_events
      add constraint message_events_slot_key_format_check
      check (slot_key is null or slot_key ~ '^[a-z][a-z0-9_-]{1,39}$');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'slot_responses_slot_key_format_check'
  ) then
    alter table public.slot_responses
      add constraint slot_responses_slot_key_format_check
      check (slot_key ~ '^[a-z][a-z0-9_-]{1,39}$');
  end if;
end $$;
