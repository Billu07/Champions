import OpenAI from "openai";
import { env } from "@/lib/config";
import { logError } from "@/lib/logger";

export type AiInstructionRoute = {
  targetType: "person" | "group";
  target: string;
  message: string;
  confidence: number;
};

type AiFallbackMeta = {
  usedFallback: boolean;
  error: string | null;
};

type AiTextResult = {
  text: string;
  meta: AiFallbackMeta;
};

type AiNamesResult = {
  names: string[];
  meta: AiFallbackMeta;
};

type AiRoutesResult = {
  routes: AiInstructionRoute[];
  meta: AiFallbackMeta;
};

export type AiBroadcastDraftMode = "rewrite" | "compose" | "regenerate";

type AiBroadcastDraftInput = {
  message: string;
  audienceHint?: string;
  previousDraft?: string;
  aiRegenerateInstruction?: string;
  preferInstructionMode?: boolean;
};

type AiBroadcastDraftResult = {
  text: string;
  mode: AiBroadcastDraftMode;
  detectedInstruction: boolean;
  meta: AiFallbackMeta;
};

const OPENAI_REQUEST_TIMEOUT_MS = 40000;

const openai = env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: env.OPENAI_API_KEY, maxRetries: 2, timeout: OPENAI_REQUEST_TIMEOUT_MS })
  : null;

function errorMessage(error: unknown): string {
  const message = (error as Error)?.message ?? "Unknown AI error";
  return message.trim() || "Unknown AI error";
}

type RunInput = {
  system: string;
  user: string;
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
};

async function runOpenAI(input: RunInput): Promise<string> {
  if (!openai) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const completion = await openai.chat.completions.create({
    model: env.OPENAI_MODEL,
    messages: [
      { role: "system", content: input.system },
      { role: "user", content: input.user },
    ],
    temperature: input.temperature ?? 0.5,
    max_tokens: input.maxTokens ?? 1500,
    ...(input.json ? { response_format: { type: "json_object" as const } } : {}),
  });

  return completion.choices[0]?.message?.content?.trim() ?? "";
}

function prefersEnglish(input: string): boolean {
  const value = input.toLowerCase();
  return /\b(english|in english|use english)\b/.test(value);
}

function languageDirective(input: string): string {
  return prefersEnglish(input)
    ? "Write the message in English."
    : "Write the message in natural, everyday Bangla (Bangla script). Keep common English business words people normally use.";
}

function detectInstructionStyle(input: string): boolean {
  const value = input.trim().toLowerCase();
  if (!value) return false;

  const instructionHints = [
    /\b(write|draft|compose|format|prepare|generate|create|make)\b/,
    /\b(message|broadcast|announcement|note|text)\b/,
    /\b(i want|we want|can you|please)\b/,
    /\bmotivat(?:e|ional)\b/,
    /\bekta\s+(message|msg|note)\b/,
    /\b(barta|message)\s+(dite|likhte|toiri|korte)\s+chai\b/,
    /\b(bolte|janate)\s+chai\b/,
    /\bmotivation(?:al)?\b/,
    /\bami\b.*\bchai\b/,
  ];

  const hits = instructionHints.reduce((count, pattern) => (pattern.test(value) ? count + 1 : count), 0);
  return hits >= 2;
}

const COMPOSE_SYSTEM = [
  'You are an expert communications assistant who drafts WhatsApp messages on behalf of the CEO of "Champions Family", a Bangladeshi field-sales company, to the team.',
  "The CEO gives you a short instruction, idea, or rough notes. Turn it into a complete, polished, ready-to-send message — the way a thoughtful human leader writes, and the way a strong conversational AI does: natural, warm, and genuinely engaging, with real substance.",
  "",
  "How to write:",
  "- Develop the idea fully. Open with a natural human line, explain the point with helpful context and detail, and close with a clear, motivating call to action.",
  "- Use natural paragraphs and line breaks for readability.",
  "- Let length follow substance: a simple notice can be a few lines; a motivational or explanatory message can run several short paragraphs. Never pad with empty filler.",
  "- Sound human and conversational, never corporate or robotic.",
  "",
  "Hard rules:",
  "- Preserve the CEO's intent, facts, names, numbers, and specific instructions exactly. Never invent facts, figures, deadlines, names, or promises the CEO did not give.",
  "- Output ONLY the final message text. No preamble, no quotation marks, no notes about what you did.",
].join("\n");

const EDIT_SYSTEM = [
  'You are editing an existing WhatsApp message for the CEO of "Champions Family". You receive the CURRENT MESSAGE and a CHANGE REQUEST.',
  "",
  "Apply ONLY the requested changes. Keep everything else exactly as written — same wording, structure, tone, formatting, and details — except where the change request requires a change. This is a precise edit, not a rewrite. Do not rephrase, restructure, shorten, or improve parts the request did not mention.",
  "",
  "Hard rules:",
  "- Make the smallest change that fully satisfies the request.",
  "- Preserve the message's language, facts, names, numbers, and line breaks unless the request changes them.",
  "- Never invent new facts, figures, deadlines, or promises.",
  "- Output ONLY the full updated message text. No preamble, no quotation marks, no explanation of what changed.",
].join("\n");

const POLISH_SYSTEM = [
  'You are lightly polishing a WhatsApp message for the CEO of "Champions Family" before it goes to the team.',
  "",
  "Keep the message essentially as-is: same meaning, information, structure, length, names, and numbers. Only fix obvious typos, awkward phrasing, or formatting. Do not rewrite, expand, shorten, simplify, or change the tone. If it is already fine, return it unchanged.",
  "",
  "Hard rules:",
  "- Never add or remove instructions, facts, figures, deadlines, or names.",
  "- Keep the original language (Bangla or English) as written.",
  "- Output ONLY the final message text. No preamble or quotation marks.",
].join("\n");

export async function enhanceCeoMessage(input: string): Promise<string> {
  const result = await enhanceCeoMessageWithMeta(input);
  return result.text;
}

export async function enhanceCeoMessageWithMeta(input: string): Promise<AiTextResult> {
  try {
    const output = await runOpenAI({
      system: POLISH_SYSTEM,
      user: `Message:\n${input}`,
      temperature: 0.2,
    });
    const text = output || input.trim();
    const meta: AiFallbackMeta = {
      usedFallback: !output,
      error: output ? null : "AI returned an empty response",
    };
    if (meta.usedFallback) {
      logError("AI enhancement fallback", { reason: meta.error });
    }
    return { text, meta };
  } catch (error) {
    const reason = errorMessage(error);
    logError("AI enhancement fallback", { reason });
    return {
      text: input.trim(),
      meta: { usedFallback: true, error: reason },
    };
  }
}

export async function buildCeoBroadcastDraftWithMeta(input: AiBroadcastDraftInput): Promise<AiBroadcastDraftResult> {
  const message = input.message.trim();
  const previousDraft = input.previousDraft?.trim() ?? "";
  const aiRegenerateInstruction = input.aiRegenerateInstruction?.trim() ?? "";
  const detectedInstruction = detectInstructionStyle(message);
  const shouldRegenerate = Boolean(aiRegenerateInstruction);
  const shouldCompose = shouldRegenerate || Boolean(input.preferInstructionMode) || detectedInstruction;
  const audienceHint = input.audienceHint?.trim() ?? "";

  // No change request and not an instruction → treat the input as a finished
  // message (possibly pasted) and only lightly polish it.
  if (!shouldCompose) {
    const polished = await enhanceCeoMessageWithMeta(message);
    return {
      text: polished.text,
      mode: "rewrite",
      detectedInstruction: false,
      meta: polished.meta,
    };
  }

  const mode: AiBroadcastDraftMode = shouldRegenerate ? "regenerate" : "compose";
  const fallbackText = shouldRegenerate ? (previousDraft || message) : message;

  // Targeted edit: a change request against an existing/pasted draft. Changes
  // only what was asked and leaves the rest intact.
  const run = shouldRegenerate
    ? runOpenAI({
        system: EDIT_SYSTEM,
        user: `CURRENT MESSAGE:\n${previousDraft || message}\n\nCHANGE REQUEST:\n${aiRegenerateInstruction}`,
        temperature: 0.3,
      })
    : runOpenAI({
        system: COMPOSE_SYSTEM,
        user: [
          languageDirective(message),
          audienceHint ? `Audience: ${audienceHint}` : "Audience: the team",
          "",
          `CEO instruction:\n${message}`,
        ].join("\n"),
        temperature: 0.6,
      });

  try {
    const output = await run;
    const text = output || fallbackText;
    const meta: AiFallbackMeta = {
      usedFallback: !output,
      error: output ? null : "AI returned an empty response",
    };
    if (meta.usedFallback) {
      logError("AI compose fallback", { reason: meta.error, mode });
    }
    return { text, mode, detectedInstruction, meta };
  } catch (error) {
    const reason = errorMessage(error);
    logError("AI compose fallback", { reason, mode });
    return {
      text: fallbackText,
      mode,
      detectedInstruction,
      meta: { usedFallback: true, error: reason },
    };
  }
}

export async function extractMentionNames(message: string): Promise<string[]> {
  const result = await extractMentionNamesWithMeta(message);
  return result.names;
}

export async function extractMentionNamesWithMeta(message: string): Promise<AiNamesResult> {
  try {
    const output = await runOpenAI({
      system: "You extract person names referenced in a WhatsApp message. Return strict JSON only.",
      user: [
        "Extract person names mentioned in this WhatsApp message.",
        'Return strict JSON: {"names":["name 1","name 2"]}',
        "Include explicit mentions and natural-language references to specific people.",
        'If no names, return {"names":[]}',
        `Message:\n${message}`,
      ].join("\n\n"),
      json: true,
      temperature: 0,
    });
    const parsed = JSON.parse(output) as { names?: string[] };
    return {
      names: (parsed.names ?? []).map((name) => name.trim()).filter(Boolean),
      meta: { usedFallback: false, error: null },
    };
  } catch (error) {
    const reason = errorMessage(error);
    logError("AI mention extraction fallback", { reason });
    return {
      names: [],
      meta: { usedFallback: true, error: reason },
    };
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
  const result = await extractInstructionRoutesWithMeta(message);
  return result.routes;
}

export async function extractInstructionRoutesWithMeta(message: string): Promise<AiRoutesResult> {
  const system = [
    "You parse a CEO's WhatsApp instruction into one or more targeted routes. Return strict JSON only.",
    "Valid group targets: sales_team, head_office, drivers, customers, all.",
    "Use targetType=person when a specific person is named; otherwise targetType=group.",
    "Write each route.message as a complete, natural, ready-to-send WhatsApp message for that target, in the same language as the instruction (Bangla by default; English if the instruction is in English).",
    "Develop the message naturally and conversationally with real substance; do not add facts, names, numbers, or deadlines the CEO did not give.",
  ].join("\n");

  const user = [
    "Return strict JSON only with this shape:",
    '{"routes":[{"targetType":"person|group","target":"string","message":"string","confidence":0.0}]}',
    "Rules:",
    "- Each route.message is specific to only that target and ready to send as-is.",
    "- If a route does not map to a valid group target, keep it as targetType=person.",
    "- Confidence must be between 0 and 1.",
    `Message:\n${message}`,
  ].join("\n");

  try {
    const output = await runOpenAI({ system, user, json: true, temperature: 0.4 });
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

    if (cleaned.length > 0) {
      return {
        routes: cleaned,
        meta: { usedFallback: false, error: null },
      };
    }

    const fallbackReason = "AI returned no valid routes";
    logError("AI route extraction fallback", { reason: fallbackReason });
    return {
      routes: heuristicInstructionRoutes(message),
      meta: { usedFallback: true, error: fallbackReason },
    };
  } catch (error) {
    const reason = errorMessage(error);
    logError("AI route extraction fallback", { reason });
    return {
      routes: heuristicInstructionRoutes(message),
      meta: { usedFallback: true, error: reason },
    };
  }
}

export async function summarizeReport(
  title: string,
  context: Record<string, unknown>,
  languageInstruction: string,
): Promise<string> {
  return runOpenAI({
    system: "You are an operations analyst writing concise, factual executive report summaries. No fluff.",
    user: [
      `Generate a concise executive report paragraph for: ${title}.`,
      "Tone: factual, direct, include key strengths, gaps, and next-day priorities.",
      languageInstruction,
      "Input JSON:",
      JSON.stringify(context),
    ].join("\n\n"),
    temperature: 0.3,
    maxTokens: 1200,
  });
}
