# Champions Family Ops

Code-first WhatsApp operations platform for:

- Scheduled sales check-in prompts
- Reply capture with slot attribution
- Daily/weekly/monthly AI reports
- CEO broadcast with mention-aware recipient resolution

## 1. Stack

- Next.js + TypeScript
- Supabase (Postgres, Cron)
- WhatsApp Cloud API
- Gemini API

## 2. Setup

1. Install dependencies:
```bash
npm install
```

2. Copy env template:
```bash
copy .env.example .env.local
```

3. Fill required values in `.env.local`.
   - For safe testing, set `WHATSAPP_TEST_ALLOWLIST_E164` as comma-separated E.164 numbers.
   - Example: `WHATSAPP_TEST_ALLOWLIST_E164=+8801683088612,+8801690000732`
   - If your morning template uses `{{body}}`, set `WHATSAPP_MORNING_TEMPLATE_BODY` to the exact long text you want delivered.
   - For secure login, set `ADMIN_LOGIN_USERNAME` and either:
     - `ADMIN_LOGIN_PASSWORD`, or
     - `ADMIN_PASSWORD_SALT` + `ADMIN_PASSWORD_HASH` (generate with `npm run admin:hash -- "YOUR_PASSWORD"`).

4. Push Supabase migrations:
```bash
supabase db push
```

5. Update cron migration placeholders and run the cron SQL in Supabase SQL editor.

## 3. Run locally

```bash
npm run dev
```

- Login URL: `/login`
- Username/password come from `ADMIN_LOGIN_USERNAME` and `ADMIN_LOGIN_PASSWORD` (or hash-based config).
- Set `NEXT_PUBLIC_ENABLE_TEST_SCHEDULER=false` to keep test scheduler disabled in production.

## 4. Core endpoints

- `GET/POST /api/webhooks/whatsapp`
- `POST /api/jobs/scheduled-send?slot=...`
- `POST /api/jobs/generate-daily-report`
- `POST /api/jobs/generate-weekly-report`
- `POST /api/jobs/generate-monthly-report`
- `POST /api/broadcasts/preview`
- `POST /api/broadcasts/send`
- `GET/POST /api/test-schedules` (only when `NEXT_PUBLIC_ENABLE_TEST_SCHEDULER=true`)
- `DELETE /api/test-schedules/:id` (only when `NEXT_PUBLIC_ENABLE_TEST_SCHEDULER=true`)
- `POST /api/test-schedules/dispatch` (only when `NEXT_PUBLIC_ENABLE_TEST_SCHEDULER=true`)

## 5. Import employee CSV

Use sample file as template:

```bash
node scripts/import-employees.mjs supabase/seed/employees.sample.csv
```

## 6. Tests

```bash
npm run test
```

## 7. Existing client artifacts

Legacy workflow references are preserved in repository root:

- `Champions - Scheduled Messages.json`
- `Champions - Capture Reply.json`
- `scheduled messages.txt`
- `supabse schema.txt`
- `Team info.xlsx`
