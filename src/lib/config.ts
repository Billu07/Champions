import { z } from "zod";

const envBoolean = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["1", "true", "yes", "on"].includes(normalized);
  }
  return false;
}, z.boolean());

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
  WHATSAPP_ACCESS_TOKEN: z.string().min(1),
  WHATSAPP_VERIFY_TOKEN: z.string().min(1),
  WHATSAPP_APP_SECRET: z.string().min(1),
  // Meta App ID — required only for the resumable upload used to set the
  // WhatsApp business profile photo (Settings → Business Profile). Optional so
  // the app still boots without it; the profile-photo upload errors clearly if
  // it is missing. Find it in the Meta App Dashboard → App settings → Basic.
  WHATSAPP_APP_ID: z.string().optional(),
  WHATSAPP_BROADCAST_TEMPLATE_NAME: z.string().default("ceo_template"),
  WHATSAPP_BROADCAST_TEMPLATE_LANGUAGE: z.string().default("en"),
  // Default template for scheduled prompts — must be a UTILITY template so
  // repeated daily sends are exempt from Meta's marketing frequency cap (131049).
  WHATSAPP_SCHEDULED_TEMPLATE_NAME: z.string().default("champion_ops_checkin"),
  WHATSAPP_MORNING_TEMPLATE_BODY: z.string().default(
    "\u0986\u099c\u0995\u09c7\u09b0 \u09a6\u09bf\u09a8\u099f\u09bf \u0986\u09a4\u09cd\u09ae\u09ac\u09bf\u09b6\u09cd\u09ac\u09be\u09b8, \u09ab\u09cb\u0995\u09be\u09b8 \u0993 \u09aa\u09c7\u09b6\u09be\u09a6\u09be\u09b0\u09bf\u09a4\u09cd\u09ac\u09c7\u09b0 \u09b8\u09be\u09a5\u09c7 \u09b6\u09c1\u09b0\u09c1 \u0995\u09b0\u09c1\u09a8\u0964",
  ),
  WHATSAPP_TEST_ALLOWLIST_E164: z.string().optional().default(""),
  CRON_JOB_SECRET: z.string().min(1),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4.1"),
  // Gold-standard daily customer visits (a rep hitting this scores 100% on the
  // customer-activity dimension). Tune to the team's expectation.
  SALES_DAILY_VISIT_TARGET: z.coerce.number().min(1).default(5),
  // Forces Whisper's language so Bengali voice notes aren't mis-detected as
  // Hindi/Arabic. Override (e.g. "en") only if voice notes aren't Bengali.
  OPENAI_TRANSCRIBE_LANGUAGE: z.string().default("bn"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-flash-latest"),
  // Optional: enables Google reverse geocoding for location-pin replies (more
  // accurate addresses in Bangladesh). If unset, falls back to free
  // OpenStreetMap/Nominatim, and to raw coordinates if that also fails.
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  NEXT_PUBLIC_APP_TIMEZONE: z.string().default("Asia/Dhaka"),
  NEXT_PUBLIC_ENABLE_TEST_SCHEDULER: envBoolean.default(false),
  ADMIN_LOGIN_USERNAME: z.string().min(3).default("admin"),
  ADMIN_LOGIN_PASSWORD: z.string().min(8).optional(),
  ADMIN_PASSWORD_HASH: z.string().min(32).optional(),
  ADMIN_PASSWORD_SALT: z.string().min(8).optional(),
  ADMIN_SESSION_SECRET: z.string().min(32).optional(),
  CEO_PANEL_PASSWORD: z.string().optional(),
  REPORT_BRAND_NAME: z.string().default("Champions Family"),
  REPORT_BRAND_TAGLINE: z.string().default("Operational Messaging Intelligence"),
});

export const env = envSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID,
  WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN,
  WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN,
  WHATSAPP_APP_SECRET: process.env.WHATSAPP_APP_SECRET,
  WHATSAPP_APP_ID: process.env.WHATSAPP_APP_ID,
  WHATSAPP_BROADCAST_TEMPLATE_NAME: process.env.WHATSAPP_BROADCAST_TEMPLATE_NAME,
  WHATSAPP_BROADCAST_TEMPLATE_LANGUAGE: process.env.WHATSAPP_BROADCAST_TEMPLATE_LANGUAGE,
  WHATSAPP_SCHEDULED_TEMPLATE_NAME: process.env.WHATSAPP_SCHEDULED_TEMPLATE_NAME,
  WHATSAPP_MORNING_TEMPLATE_BODY: process.env.WHATSAPP_MORNING_TEMPLATE_BODY,
  WHATSAPP_TEST_ALLOWLIST_E164: process.env.WHATSAPP_TEST_ALLOWLIST_E164,
  CRON_JOB_SECRET: process.env.CRON_JOB_SECRET,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  OPENAI_TRANSCRIBE_LANGUAGE: process.env.OPENAI_TRANSCRIBE_LANGUAGE,
  SALES_DAILY_VISIT_TARGET: process.env.SALES_DAILY_VISIT_TARGET,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL,
  GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY,
  NEXT_PUBLIC_APP_TIMEZONE: process.env.NEXT_PUBLIC_APP_TIMEZONE,
  NEXT_PUBLIC_ENABLE_TEST_SCHEDULER: process.env.NEXT_PUBLIC_ENABLE_TEST_SCHEDULER,
  ADMIN_LOGIN_USERNAME: process.env.ADMIN_LOGIN_USERNAME,
  ADMIN_LOGIN_PASSWORD: process.env.ADMIN_LOGIN_PASSWORD,
  ADMIN_PASSWORD_HASH: process.env.ADMIN_PASSWORD_HASH,
  ADMIN_PASSWORD_SALT: process.env.ADMIN_PASSWORD_SALT,
  ADMIN_SESSION_SECRET: process.env.ADMIN_SESSION_SECRET,
  CEO_PANEL_PASSWORD: process.env.CEO_PANEL_PASSWORD,
  REPORT_BRAND_NAME: process.env.REPORT_BRAND_NAME,
  REPORT_BRAND_TAGLINE: process.env.REPORT_BRAND_TAGLINE,
});
