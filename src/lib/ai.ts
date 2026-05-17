import { env } from "@/lib/config";

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: {
    message?: string;
    code?: number;
    status?: string;
  };
};

export type AiInstructionRoute = {
  targetType: "person" | "group";
  target: string;
  message: string;
  confidence: number;
};

async function runGemini(prompt: string, asJson = false): Promise<string> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: asJson ? "application/json" : "text/plain",
      },
    }),
  });

  const data = (await response.json().catch(() => ({}))) as GeminiResponse;

  if (!response.ok) {
    const details = data.error?.message?.trim();
    const statusText = response.statusText?.trim();
    const extra = details || statusText || "Unknown Gemini error";
    throw new Error(`Gemini request failed (${response.status}): ${extra}`);
  }

  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";

  return text.trim();
}

export async function enhanceCeoMessage(input: string): Promise<string> {
  const prompt = [
    "Rewrite this internal CEO broadcast in very simple, natural Bengali.",
    "Style rules:",
    "- Keep the original meaning, people, and instructions exactly the same.",
    "- Do minimal edits only; do not over-polish.",
    "- Use short, everyday words and short sentences.",
    "- Avoid corporate/formal language, heavy adjectives, and dramatic wording.",
    "- Keep it warm and direct, like normal team communication.",
    "- Do not add any new instruction, target, or deadline.",
    "- Primary output language: Bengali (Bangla script), unless input explicitly asks for English.",
    "- Return only the final message text, no heading or explanation.",
    "",
    `Message:\n${input}`,
  ].join("\n");

  try {
    const output = await runGemini(prompt, false);
    return output || input.trim();
  } catch {
    return input.trim();
  }
}

export async function extractMentionNames(message: string): Promise<string[]> {
  const prompt = [
    "Extract person names mentioned in this WhatsApp message.",
    "Return strict JSON: {\"names\":[\"name 1\",\"name 2\"]}",
    "Include explicit mentions and natural language references to specific people.",
    "If no names, return {\"names\":[]}",
    `Message:\n${message}`,
  ].join("\n\n");

  try {
    const output = await runGemini(prompt, true);
    const parsed = JSON.parse(output) as { names?: string[] };
    return (parsed.names ?? []).map((name) => name.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function normalizeGroupTarget(target: string): string {
  const value = target.trim().toLowerCase();
  if (["sales", "sales team", "field sales", "sales_field"].includes(value)) return "sales_team";
  if (["head office", "ho", "office", "head_office"].includes(value)) return "head_office";
  if (["driver", "drivers"].includes(value)) return "drivers";
  if (["customer", "customers", "client", "clients"].includes(value)) return "customers";
  if (["all", "everyone", "whole team", "entire team"].includes(value)) return "all";
  return value;
}

function heuristicInstructionRoutes(message: string): AiInstructionRoute[] {
  const chunks = message
    .split(/\n|[.;]|,(?=\s*tell\s)/gi)
    .map((part) => part.trim())
    .filter(Boolean);

  const routes: AiInstructionRoute[] = [];
  const tellPattern = /^tell\s+(.+?)\s+to\s+(.+)$/i;

  for (const chunk of chunks) {
    const match = chunk.match(tellPattern);
    if (!match) continue;
    const [, targetRaw, instructionRaw] = match;
    const target = targetRaw.trim();
    const normalizedGroup = normalizeGroupTarget(target);
    const isGroup = ["sales_team", "head_office", "drivers", "customers", "all"].includes(normalizedGroup);

    routes.push({
      targetType: isGroup ? "group" : "person",
      target: isGroup ? normalizedGroup : target,
      message: instructionRaw.trim(),
      confidence: 0.55,
    });
  }

  if (routes.length > 0) return routes;

  return [
    {
      targetType: "group",
      target: "all",
      message: message.trim(),
      confidence: 0.4,
    },
  ];
}

export async function extractInstructionRoutes(message: string): Promise<AiInstructionRoute[]> {
  const prompt = [
    "You are parsing a CEO WhatsApp instruction.",
    "Extract one or more targeted routes from the message.",
    "Valid group targets: sales_team, head_office, drivers, customers, all.",
    "Use targetType=person when a specific person is named.",
    "Return strict JSON only with this shape:",
    "{\"routes\":[{\"targetType\":\"person|group\",\"target\":\"string\",\"message\":\"string\",\"confidence\":0.0}]}",
    "Rules:",
    "- Keep each route message concise and specific to only that target.",
    "- If a route does not map to a valid group target, keep it as targetType=person.",
    "- Confidence must be between 0 and 1.",
    `Message:\n${message}`,
  ].join("\n\n");

  try {
    const output = await runGemini(prompt, true);
    const parsed = JSON.parse(output) as { routes?: AiInstructionRoute[] };
    const cleaned = (parsed.routes ?? [])
      .map((route) => {
        const targetType: AiInstructionRoute["targetType"] =
          route.targetType === "group" ? "group" : "person";
        return {
          targetType,
          target:
            targetType === "group"
              ? normalizeGroupTarget(String(route.target ?? ""))
              : String(route.target ?? "").trim(),
          message: String(route.message ?? "").trim(),
          confidence: Math.max(0, Math.min(1, Number(route.confidence ?? 0))),
        };
      })
      .filter((route) => route.target && route.message);

    return cleaned.length > 0 ? cleaned : heuristicInstructionRoutes(message);
  } catch {
    return heuristicInstructionRoutes(message);
  }
}

export async function summarizeReport(
  title: string,
  context: Record<string, unknown>,
  languageInstruction: string,
): Promise<string> {
  const prompt = [
    `Generate a concise executive report paragraph for: ${title}.`,
    "Tone: factual, direct, no fluff, include key strengths, gaps, and next-day priorities.",
    languageInstruction,
    "Input JSON:",
    JSON.stringify(context),
  ].join("\n\n");

  return runGemini(prompt, false);
}
