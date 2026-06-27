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
    ? "The CEO explicitly asked for English, so write the message in English."
    : "Write in natural business Bangla (Bangla script) — the way an experienced Bangladeshi CEO personally talks to his team: warm, clear, human, and direct, never stiff or robotic. Keep the everyday English business words people normally use.";
}

// The CEO whose voice every broadcast must sound like. Distilled from his
// executive-communication persona so every drafting path shares one voice.
const CEO_PERSONA = [
  "You are writing in the personal voice of Mohammad Monir Hossain, CEO of Champion Family Bangladesh — the official sole agent of SINSIM embroidery machines. Every message must feel personally written and sent by him; the reader must never sense an assistant or AI was involved.",
  "Voice: natural business Bangla, the way an experienced, confident Bangladeshi company CEO actually talks to his own team — warm, human, and personable, with real personality, as if speaking in a genuine conversation. Professional and clear, but never stiff, never over-formal, never government-style.",
  "Never sound robotic, scripted, or like a chatbot. No marketing language, no exaggerated claims, no generic corporate clichés, no AI-style phrases. No emojis, no hashtags, no decorative formatting.",
  "You may keep the everyday English business words people normally mix in (target, team, sales, customer, visit, follow-up, etc.).",
  "Purpose: build trust, create clarity, and drive action — leadership that strengthens relationships and accountability.",
].join("\n");

// The non-negotiable completeness rule: polish his words, never shrink them.
const PRESERVE_EVERYTHING = [
  "Completeness is critical. Include EVERY point, instruction, fact, name, number, date, and nuance the CEO expressed — do not summarize, condense, generalize, merge, or drop anything he said.",
  "Your job is to turn his rough or spoken words into polished, professional phrasing in his own voice — improving clarity and flow, never reducing the substance. When in doubt, keep the detail.",
  "Never invent facts, figures, names, deadlines, or promises he did not give.",
].join("\n");

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
  CEO_PERSONA,
  "",
  "You receive the CEO's own words — often a transcribed voice note or a rough instruction. Turn them into ONE complete, ready-to-send WhatsApp message to his team, written exactly as if he wrote it himself.",
  "",
  PRESERVE_EVERYTHING,
  "",
  "Shape:",
  "- Write it the way he would actually say it in conversation: a natural human opening, every point he made laid out clearly in order, and a clear close or call to action.",
  "- Use short, clear sentences and natural line breaks so it reads easily on WhatsApp. Make it exactly as long as it needs to be to carry all of his points — neither padded nor trimmed.",
  "",
  "Language: write in Bengali (Bangla script) unless the CEO explicitly asked for English. Even if his words are in English or romanized Bengali, the final message must be in Bengali unless English is explicitly requested.",
  "",
  "Output ONLY the final message text. No preamble, no quotation marks, no notes about what you did.",
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
  CEO_PERSONA,
  "",
  "You are refining a message the CEO is about to send to his team. Keep ALL of its meaning, information, points, names, and numbers exactly — never add or remove any of them.",
  "Fix typos and rough or spoken phrasing so it reads as clean, professional Bangla in his voice. Do not summarize, shorten, expand with new ideas, or change what he is saying — only improve how it reads. If it is already clean, return it unchanged.",
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
        temperature: 0.45,
        maxTokens: 2000,
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
    "For each route, write route.message as a COMPLETE, ready-to-send broadcast message for that target.",
    "",
    CEO_PERSONA,
    "",
    PRESERVE_EVERYTHING,
    "For each target, include every point the CEO meant for that target — do not summarize or drop any of it.",
    "",
    "Write each message the way the CEO would actually say it — a natural opening, every relevant point in order, and a clear close — in short, clear sentences with natural line breaks.",
    "Language: write each message in Bengali (Bangla script) unless the CEO explicitly asks for English; even if the instruction is in English or romanized Bengali, the message must be Bengali unless English is explicitly requested.",
  ].join("\n");

  const user = [
    "Return strict JSON only with this shape:",
    '{"routes":[{"targetType":"person|group","target":"string","message":"string","confidence":0.0}]}',
    "Rules:",
    "- Each route.message is specific to only that target and ready to send as-is, in natural professional Bangla in the CEO's voice (unless English is explicitly requested), keeping every point and detail meant for that target.",
    "- If a route does not map to a valid group target, keep it as targetType=person.",
    "- Confidence must be between 0 and 1.",
    `Message:\n${message}`,
  ].join("\n");

  try {
    const output = await runOpenAI({ system, user, json: true, temperature: 0.5, maxTokens: 3000 });
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

export async function transcribeVoiceNote(file: File): Promise<string> {
  if (!openai) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const isBengali = env.OPENAI_TRANSCRIBE_LANGUAGE.toLowerCase().startsWith("bn");

  const result = await openai.audio.transcriptions.create({
    model: "whisper-1",
    file,
    // We do NOT pass `language`: the API rejects some ISO codes (e.g. "bn").
    // Instead we bias toward Bengali with a same-language prompt, and the draft
    // step (always Bengali) cleans up any residual mis-detection.
    ...(isBengali
      ? { prompt: "এটি Champions Family টিমের জন্য একটি বাংলা ভয়েস নোট। সহজ, স্বাভাবিক বাংলায় লেখো।" }
      : {}),
  });

  return (result.text ?? "").trim();
}

export type FieldReportExtract = {
  customersVisited: number;
  leads: number;
  locationShared: boolean;
  blockers: string | null;
  highlight: string | null;
  summary: string;
};

const EMPTY_FIELD_REPORT: FieldReportExtract = {
  customersVisited: 0,
  leads: 0,
  locationShared: false,
  blockers: null,
  highlight: null,
  summary: "",
};

// Turns a rep's day of WhatsApp replies into structured field-sales data so the
// report can score real performance (visits, leads, location) rather than
// keyword guesses. Resilient: returns an empty record on any failure.
export async function extractFieldReport(input: {
  employeeName: string;
  date: string;
  replies: string;
}): Promise<FieldReportExtract> {
  if (!openai || !input.replies.trim()) return { ...EMPTY_FIELD_REPORT };

  try {
    const output = await runOpenAI({
      system:
        "You extract structured field-sales performance data from a Bangladeshi sales rep's WhatsApp replies to daily check-ins. Return strict JSON only. Be conservative: count only what is clearly stated; when unknown use 0, false, or null.",
      user: [
        "Extract this exact shape:",
        '{"customers_visited": number, "leads": number, "location_shared": boolean, "blockers": string|null, "highlight": string|null, "summary": string}',
        "- customers_visited: how many customers they visited/followed up today (best concrete number; 0 if none/unclear).",
        "- leads: count of new leads / POs / promising clients mentioned (0 if none).",
        "- location_shared: true if they shared a location or live location.",
        "- blockers: any problem/blocker/help request, else null.",
        "- highlight: the best achievement they mentioned, else null.",
        "- summary: one short plain-English sentence summarizing their day.",
        "",
        `Rep: ${input.employeeName}`,
        `Date: ${input.date}`,
        `Replies:\n${input.replies}`,
      ].join("\n"),
      json: true,
      temperature: 0,
      maxTokens: 500,
    });
    const parsed = JSON.parse(output) as Record<string, unknown>;
    return {
      customersVisited: Math.max(0, Math.floor(Number(parsed.customers_visited ?? 0)) || 0),
      leads: Math.max(0, Math.floor(Number(parsed.leads ?? 0)) || 0),
      locationShared: Boolean(parsed.location_shared),
      blockers: typeof parsed.blockers === "string" && parsed.blockers.trim() ? parsed.blockers.trim() : null,
      highlight: typeof parsed.highlight === "string" && parsed.highlight.trim() ? parsed.highlight.trim() : null,
      summary: typeof parsed.summary === "string" ? parsed.summary.trim() : "",
    };
  } catch (error) {
    logError("Field report extraction failed", { reason: errorMessage(error), employee: input.employeeName });
    return { ...EMPTY_FIELD_REPORT };
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
