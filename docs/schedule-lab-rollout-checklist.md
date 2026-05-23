## Schedule Lab Rollout Checklist

Use this exact order to move safely to dynamic schedules.

### 1) Run migrations (SQL Editor)

Use the track that matches your environment:

Track A: Existing live project (already has employees/message tables)
1. `supabase/migrations/0005_schedule_lab.sql`
2. `supabase/migrations/0006_dynamic_report_slots.sql`

Track B: Fresh empty database
1. `supabase/migrations/0001_init.sql`
2. `supabase/migrations/0003_broadcast_delivery_status.sql`
3. `supabase/migrations/0004_reporting_upgrade.sql`
4. `supabase/migrations/0005_schedule_lab.sql`
5. `supabase/migrations/0006_dynamic_report_slots.sql`

Notes:
- Do not run `0002_cron_jobs.sql` directly (it has old hardcoded URL/secret values).
- Use `docs/schedule-lab-cron.sql` instead for cron setup.

### 2) Configure cron jobs

Open `docs/schedule-lab-cron.sql`, replace:
- `{{APP_URL}}` with your Vercel URL
- `{{CRON_SECRET}}` with `CRON_JOB_SECRET`

Then run the full script.

This script does all of these safely:
- removes old fixed-slot scheduler jobs
- adds 1-minute dynamic dispatcher job
- re-creates daily, weekly, monthly report jobs

### 3) Verify cron state

Run:

```sql
select jobid, jobname, schedule, active
from cron.job
where jobname like 'cf_%'
order by jobid;
```

Expected active jobs:
- `cf_send_schedule_lab_dispatch`
- `cf_generate_daily_report`
- `cf_generate_weekly_report`
- `cf_generate_monthly_report`

Expected inactive or missing:
- `cf_send_morning`
- `cf_send_noon`
- `cf_send_afternoon`
- `cf_send_evening`

### 4) Functional smoke test

1. In Schedule Lab, create one active test schedule for the next 2-3 minutes.
2. Confirm test recipients have `tracking_enabled = true` and are in allowlist (if allowlist is enabled).
3. Check `job_runs` and `message_events` for dispatch.
4. Reply from a test recipient and verify `slot_responses` updated when `report_slot_key` is set.
5. Trigger daily report endpoint once and confirm report rows in `reports`.
