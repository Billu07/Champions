-- 0002_cron_jobs.sql
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- Replace YOUR_VERCEL_APP_URL and YOUR_CRON_SECRET before running.

select cron.schedule(
  'cf_send_morning',
  '0 2 * * 0-4,6',
  $$
  select net.http_post(
    url := 'https://champions-family-ops.vercel.app/api/jobs/scheduled-send?slot=morning',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '0891d8d5f6c0c5dcff013eed747ac4c9b5c28cf48dd33ec1c0c11e42f0abba48'
    )
  );
  $$
);

select cron.schedule(
  'cf_send_noon',
  '0 6 * * 0-4,6',
  $$
  select net.http_post(
    url := 'https://champions-family-ops.vercel.app/api/jobs/scheduled-send?slot=noon',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '0891d8d5f6c0c5dcff013eed747ac4c9b5c28cf48dd33ec1c0c11e42f0abba48'
    )
  );
  $$
);

select cron.schedule(
  'cf_send_afternoon',
  '0 9 * * 0-4,6',
  $$
  select net.http_post(
    url := 'https://champions-family-ops.vercel.app/api/jobs/scheduled-send?slot=afternoon',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '0891d8d5f6c0c5dcff013eed747ac4c9b5c28cf48dd33ec1c0c11e42f0abba48'
    )
  );
  $$
);

select cron.schedule(
  'cf_send_evening',
  '30 11 * * 0-4,6',
  $$
  select net.http_post(
    url := 'https://champions-family-ops.vercel.app/api/jobs/scheduled-send?slot=evening',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '0891d8d5f6c0c5dcff013eed747ac4c9b5c28cf48dd33ec1c0c11e42f0abba48'
    )
  );
  $$
);

-- Daily report at 18:45 Asia/Dhaka (12:45 UTC), Sat-Thu.
select cron.schedule(
  'cf_generate_daily_report',
  '45 12 * * 0-4,6',
  $$
  select net.http_post(
    url := 'https://champions-family-ops.vercel.app/api/jobs/generate-daily-report',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '0891d8d5f6c0c5dcff013eed747ac4c9b5c28cf48dd33ec1c0c11e42f0abba48'
    )
  );
  $$
);

-- Weekly report at 20:00 Asia/Dhaka on Thursday (14:00 UTC, Thursday=4 in UTC cron).
select cron.schedule(
  'cf_generate_weekly_report',
  '0 14 * * 4',
  $$
  select net.http_post(
    url := 'https://champions-family-ops.vercel.app/api/jobs/generate-weekly-report',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '0891d8d5f6c0c5dcff013eed747ac4c9b5c28cf48dd33ec1c0c11e42f0abba48'
    )
  );
  $$
);

-- Monthly report at 20:15 Asia/Dhaka on day 1 of each month (14:15 UTC).
select cron.schedule(
  'cf_generate_monthly_report',
  '15 14 1 * *',
  $$
  select net.http_post(
    url := 'https://champions-family-ops.vercel.app/api/jobs/generate-monthly-report',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '0891d8d5f6c0c5dcff013eed747ac4c9b5c28cf48dd33ec1c0c11e42f0abba48'
    )
  );
  $$
);
