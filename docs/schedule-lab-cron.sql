-- Schedule Lab cron setup (Supabase pg_cron + pg_net)
-- Replace:
--   {{APP_URL}} with your Vercel app URL (no trailing slash)
--   {{CRON_SECRET}} with your CRON_JOB_SECRET

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- Disable old fixed-slot jobs (legacy mode).
select cron.unschedule('cf_send_morning') where exists (select 1 from cron.job where jobname = 'cf_send_morning');
select cron.unschedule('cf_send_noon') where exists (select 1 from cron.job where jobname = 'cf_send_noon');
select cron.unschedule('cf_send_afternoon') where exists (select 1 from cron.job where jobname = 'cf_send_afternoon');
select cron.unschedule('cf_send_evening') where exists (select 1 from cron.job where jobname = 'cf_send_evening');

-- Remove old/new jobs so this script is re-runnable safely.
select cron.unschedule('cf_send_schedule_lab_dispatch')
where exists (select 1 from cron.job where jobname = 'cf_send_schedule_lab_dispatch');
select cron.unschedule('cf_generate_daily_report')
where exists (select 1 from cron.job where jobname = 'cf_generate_daily_report');
select cron.unschedule('cf_generate_weekly_report')
where exists (select 1 from cron.job where jobname = 'cf_generate_weekly_report');
select cron.unschedule('cf_generate_monthly_report')
where exists (select 1 from cron.job where jobname = 'cf_generate_monthly_report');

-- Dispatch due schedule-lab entries every minute (UTC cron, app applies Asia/Dhaka timezone logic).
select cron.schedule(
  'cf_send_schedule_lab_dispatch',
  '* * * * *',
  format($$
    select net.http_post(
      url := '%s/api/jobs/scheduled-send',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', '%s'
      )
    );
  $$, 'https://champions-family-ops.vercel.app/', '0891d8d5f6c0c5dcff013eed747ac4c9b5c28cf48dd33ec1c0c11e42f0abba48')
);

-- Daily report at 18:45 Asia/Dhaka (12:45 UTC), Sat-Thu.
select cron.schedule(
  'cf_generate_daily_report',
  '45 12 * * 0-4,6',
  format($$
    select net.http_post(
      url := '%s/api/jobs/generate-daily-report',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', '%s'
      )
    );
  $$, 'https://champions-family-ops.vercel.app/', '0891d8d5f6c0c5dcff013eed747ac4c9b5c28cf48dd33ec1c0c11e42f0abba48')
);

-- Weekly report at 20:00 Asia/Dhaka on Thursday (14:00 UTC).
select cron.schedule(
  'cf_generate_weekly_report',
  '0 14 * * 4',
  format($$
    select net.http_post(
      url := '%s/api/jobs/generate-weekly-report',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', '%s'
      )
    );
  $$, 'https://champions-family-ops.vercel.app/', '0891d8d5f6c0c5dcff013eed747ac4c9b5c28cf48dd33ec1c0c11e42f0abba48')
);

-- Monthly report at 20:15 Asia/Dhaka on day 1 (14:15 UTC).
select cron.schedule(
  'cf_generate_monthly_report',
  '15 14 1 * *',
  format($$
    select net.http_post(
      url := '%s/api/jobs/generate-monthly-report',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', '%s'
      )
    );
  $$, 'https://champions-family-ops.vercel.app/', '0891d8d5f6c0c5dcff013eed747ac4c9b5c28cf48dd33ec1c0c11e42f0abba48')
);

-- Verification query:
-- select jobid, jobname, schedule, active from cron.job where jobname like 'cf_%' order by jobid;
