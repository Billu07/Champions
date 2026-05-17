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

const baseUrl = `https://graph.facebook.com/v25.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

function assertRecipientAllowed(toE164: string): void {
  if (!isWhatsAppRecipientAllowed(toE164)) {
    throw new Error(
      `Blocked by WHATSAPP_TEST_ALLOWLIST_E164: ${toE164} is not in the allowed test recipients`,
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
