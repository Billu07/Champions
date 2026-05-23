-- 0005_schedule_lab.sql
-- Flexible schedule lab entries for dynamic scheduled prompts.

create table if not exists public.schedule_lab_entries (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  minute_of_day integer not null check (minute_of_day >= 0 and minute_of_day <= 1439),
  body_text text not null,
  template_name text not null default 'ceo_template',
  language_code text not null default 'en',
  is_active boolean not null default true,
  legacy_slot_key text unique check (legacy_slot_key in ('morning','noon','afternoon','evening')),
  report_slot_key text check (report_slot_key in ('morning','noon','afternoon','evening')),
  report_mandatory boolean not null default true,
  report_critical boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_schedule_lab_entries_updated_at on public.schedule_lab_entries;

create trigger trg_schedule_lab_entries_updated_at
before update on public.schedule_lab_entries
for each row
execute function public.set_updated_at();

create unique index if not exists idx_schedule_lab_entries_active_minute_unique
  on public.schedule_lab_entries (minute_of_day)
  where is_active;

create unique index if not exists idx_schedule_lab_entries_active_report_slot_unique
  on public.schedule_lab_entries (report_slot_key)
  where is_active and report_slot_key is not null;

insert into public.schedule_lab_entries (
  label,
  minute_of_day,
  body_text,
  template_name,
  language_code,
  is_active,
  legacy_slot_key,
  report_slot_key,
  report_mandatory,
  report_critical
)
values
  (
    'Morning Motivation',
    480,
    'আজকের দিনটি আত্মবিশ্বাস, ফোকাস ও পেশাদারিত্বের সাথে শুরু করুন।',
    'ceo_template',
    'en',
    true,
    'morning',
    'morning',
    false,
    false
  ),
  (
    'Noon Update',
    720,
    'আপনার বর্তমান অবস্থা ও কাজের অগ্রগতি জানান।',
    'ceo_template',
    'en',
    true,
    'noon',
    'noon',
    true,
    false
  ),
  (
    'Afternoon Progress',
    900,
    'বিকেলের কাজের অবস্থা ও মাঠের অগ্রগতি সংক্ষেপে জানান।',
    'ceo_template',
    'en',
    true,
    'afternoon',
    'afternoon',
    true,
    true
  ),
  (
    'Evening Report',
    1050,
    'আজকের দিনশেষ রিপোর্ট দিন: কতজনের সাথে কথা বলেছেন এবং কী অগ্রগতি হয়েছে।',
    'ceo_template',
    'en',
    true,
    'evening',
    'evening',
    true,
    true
  )
on conflict (legacy_slot_key) do update
set label = excluded.label,
    minute_of_day = excluded.minute_of_day,
    body_text = excluded.body_text,
    template_name = excluded.template_name,
    language_code = excluded.language_code,
    is_active = excluded.is_active,
    report_slot_key = excluded.report_slot_key,
    report_mandatory = excluded.report_mandatory,
    report_critical = excluded.report_critical,
    updated_at = now();
