# Champions Family Ops

Code-first WhatsApp operations platform for:

- Scheduled sales check-in prompts
- Reply capture with slot attribution
- Daily/weekly AI reports
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
- Password comes from `CEO_PANEL_PASSWORD`.

## 4. Core endpoints

- `GET/POST /api/webhooks/whatsapp`
- `POST /api/jobs/scheduled-send?slot=...`
- `POST /api/jobs/generate-daily-report`
- `POST /api/jobs/generate-weekly-report`
- `POST /api/broadcasts/preview`
- `POST /api/broadcasts/send`

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
