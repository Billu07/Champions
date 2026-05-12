import { env } from "@/lib/config";

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
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
    throw new Error("Gemini request failed");
  }

  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";

  return text.trim();
}

export async function enhanceCeoMessage(input: string): Promise<string> {
  const prompt = `You are rewriting an internal CEO message for team communication.\nKeep the language intent and key instructions unchanged.\nImprove clarity, professional tone, and actionability.\nReturn only the rewritten message text.\n\nMessage:\n${input}`;

  return runGemini(prompt, false);
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
