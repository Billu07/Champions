import { env } from "@/lib/config";
import { whatsappRecipientFromE164 } from "@/lib/phone";
import { isWhatsAppRecipientAllowed } from "@/lib/whatsapp-test-allowlist";

type SendTemplateInput = {
  toE164: string;
  templateName: string;
  employeeName: string;
  languageCode?: string;
};

type TemplateParam = {
  type: "text";
  text: string;
  parameterName?: string;
};

type SendDynamicTemplateInput = {
  toE164: string;
  templateName: string;
  languageCode?: string;
  bodyParameters?: TemplateParam[];
};

type SendTextInput = {
  toE164: string;
  message: string;
};

const graphBase = "https://graph.facebook.com/v25.0";
const baseUrl = `${graphBase}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
const profileUrl = `${graphBase}/${env.WHATSAPP_PHONE_NUMBER_ID}/whatsapp_business_profile`;

// Fields recipients can see / that the Business Profile endpoint exposes.
const PROFILE_READ_FIELDS = "about,address,description,email,profile_picture_url,websites,vertical";

export type BusinessProfile = {
  about?: string;
  address?: string;
  description?: string;
  email?: string;
  profile_picture_url?: string;
  websites?: string[];
  vertical?: string;
};

// Writable subset of the profile. `profile_picture_handle` is the handle
// returned by the resumable upload (see uploadResumableMedia).
export type BusinessProfileUpdate = {
  about?: string;
  address?: string;
  description?: string;
  email?: string;
  websites?: string[];
  vertical?: string;
  profile_picture_handle?: string;
};

type GraphErrorBody = {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
    error_data?: { details?: string };
  };
};

function formatGraphError(json: GraphErrorBody, fallback: string): string {
  const message = json.error?.message?.trim() || fallback;
  const code = json.error?.code ? `(${json.error.code}) ` : "";
  const details = json.error?.error_data?.details?.trim();
  return `${code}${message}${details ? ` | ${details}` : ""}`;
}

function assertRecipientAllowed(toE164: string): void {
  if (!isWhatsAppRecipientAllowed(toE164)) {
    throw new Error(
      `Blocked by WHATSAPP_TEST_ALLOWLIST_E164: ${toE164} is not in the allowed test recipients`,
    );
  }
}

// WhatsApp rejects newline/tab characters and >4 consecutive spaces inside
// template body parameters (error 132018). Flatten parameter text so dynamic,
// multi-line content (e.g. schedule body text) still delivers.
function sanitizeTemplateParamText(text: string): string {
  return text.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
}

async function send(body: Record<string, unknown>): Promise<{ id?: string }> {
  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = (await response.json().catch(() => ({}))) as {
    messages?: Array<{ id?: string }>;
    error?: {
      message?: string;
      code?: number;
      error_subcode?: number;
      error_data?: {
        details?: string;
      };
    };
  };

  if (!response.ok) {
    const message = json.error?.message?.trim() || "WhatsApp API send failed";
    const code = json.error?.code ? `(${json.error.code}) ` : "";
    const details = json.error?.error_data?.details?.trim();
    throw new Error(`${code}${message}${details ? ` | ${details}` : ""}`);
  }

  return { id: json.messages?.[0]?.id };
}

export async function sendTemplateMessage(input: SendTemplateInput): Promise<{ id?: string }> {
  return sendDynamicTemplateMessage({
    toE164: input.toE164,
    templateName: input.templateName,
    languageCode: input.languageCode,
    bodyParameters: [
      {
        type: "text",
        text: input.employeeName,
        parameterName: "employee_name",
      },
    ],
  });
}

export async function sendDynamicTemplateMessage(input: SendDynamicTemplateInput): Promise<{ id?: string }> {
  assertRecipientAllowed(input.toE164);

  const components =
    input.bodyParameters && input.bodyParameters.length > 0
      ? [
          {
            type: "body",
            parameters: input.bodyParameters.map((item) => ({
              type: "text",
              text: sanitizeTemplateParamText(item.text),
              ...(item.parameterName ? { parameter_name: item.parameterName } : {}),
            })),
          },
        ]
      : [];

  return send({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: whatsappRecipientFromE164(input.toE164),
    type: "template",
    template: {
      name: input.templateName,
      language: {
        code: input.languageCode || "en",
      },
      components,
    },
  });
}

export async function sendTextMessage(input: SendTextInput): Promise<{ id?: string }> {
  assertRecipientAllowed(input.toE164);

  return send({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: whatsappRecipientFromE164(input.toE164),
    type: "text",
    text: {
      preview_url: false,
      body: input.message,
    },
  });
}

// --- Business profile (what message recipients see) ----------------------

// Reads the current WhatsApp business profile for the configured phone number.
export async function getBusinessProfile(): Promise<BusinessProfile> {
  const response = await fetch(`${profileUrl}?fields=${PROFILE_READ_FIELDS}`, {
    headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` },
    cache: "no-store",
  });

  const json = (await response.json().catch(() => ({}))) as
    & GraphErrorBody
    & { data?: BusinessProfile[] };

  if (!response.ok) {
    throw new Error(formatGraphError(json, "Failed to read business profile"));
  }

  return json.data?.[0] ?? {};
}

// Updates one or more business-profile fields. Accepts a profile_picture_handle
// from uploadResumableMedia to change the photo recipients see.
export async function updateBusinessProfile(update: BusinessProfileUpdate): Promise<void> {
  const response = await fetch(profileUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", ...update }),
  });

  const json = (await response.json().catch(() => ({}))) as
    & GraphErrorBody
    & { success?: boolean };

  if (!response.ok || json.success === false) {
    throw new Error(formatGraphError(json, "Failed to update business profile"));
  }
}

// Uploads binary data via Meta's two-step Resumable Upload API and returns the
// file handle ("h"), which other Graph endpoints (e.g. the business profile
// photo) accept. Requires WHATSAPP_APP_ID.
export async function uploadResumableMedia(input: {
  data: Blob;
  mimeType: string;
  fileName: string;
}): Promise<string> {
  if (!env.WHATSAPP_APP_ID) {
    throw new Error(
      "WHATSAPP_APP_ID is not configured — required to upload a business profile photo.",
    );
  }

  // Step 1: open an upload session against the app.
  const startUrl =
    `${graphBase}/${env.WHATSAPP_APP_ID}/uploads` +
    `?file_name=${encodeURIComponent(input.fileName)}` +
    `&file_length=${input.data.size}` +
    `&file_type=${encodeURIComponent(input.mimeType)}`;

  const startRes = await fetch(startUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` },
  });
  const startJson = (await startRes.json().catch(() => ({}))) as
    & GraphErrorBody
    & { id?: string };

  if (!startRes.ok || !startJson.id) {
    throw new Error(formatGraphError(startJson, "Failed to start media upload"));
  }

  // Step 2: upload the bytes; returns the reusable file handle.
  const uploadRes = await fetch(`${graphBase}/${startJson.id}`, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${env.WHATSAPP_ACCESS_TOKEN}`,
      file_offset: "0",
    },
    body: input.data,
  });
  const uploadJson = (await uploadRes.json().catch(() => ({}))) as
    & GraphErrorBody
    & { h?: string };

  if (!uploadRes.ok || !uploadJson.h) {
    throw new Error(formatGraphError(uploadJson, "Failed to upload media"));
  }

  return uploadJson.h;
}
