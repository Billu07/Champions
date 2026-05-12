# Migrations Notes

1. Run `supabase db push` after placing migration files in your Supabase project.
2. Update values in `0002_cron_jobs.sql`:
   - `YOUR_VERCEL_APP_URL`
   - `YOUR_CRON_SECRET`
3. Confirm cron jobs are created:
   - `select * from cron.job order by jobid;`
4. Verify webhook endpoint in Meta app configuration:
   - `GET /api/webhooks/whatsapp`
   - `POST /api/webhooks/whatsapp`
