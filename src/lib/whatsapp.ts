import { env } from "@/lib/config";
import { normalizeBangladeshPhone, whatsappRecipientFromE164 } from "@/lib/phone";

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

const baseUrl = `https://graph.facebook.com/v25.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

const testAllowlist = new Set(
  env.WHATSAPP_TEST_ALLOWLIST_E164.split(",")
    .map((item) => normalizeBangladeshPhone(item.trim()))
    .filter(Boolean),
);

function assertRecipientAllowed(toE164: string): void {
  if (testAllowlist.size === 0) return;

  const normalized = normalizeBangladeshPhone(toE164);
  if (!testAllowlist.has(normalized)) {
    throw new Error(
      `Blocked by WHATSAPP_TEST_ALLOWLIST_E164: ${normalized} is not in the allowed test recipients`,
    );
  }
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
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(json.error?.message || "WhatsApp API send failed");
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
              text: item.text,
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
