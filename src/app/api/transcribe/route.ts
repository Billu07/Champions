import { fail, ok } from "@/lib/http";
import { requestHasAdminSession } from "@/lib/auth";
import { transcribeVoiceNote } from "@/lib/ai";
import { logError } from "@/lib/logger";

export const runtime = "nodejs";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // Whisper API limit

export async function POST(request: Request) {
  try {
    if (!(await requestHasAdminSession(request))) {
      return fail("Unauthorized", 401);
    }

    const form = await request.formData().catch(() => null);
    const file = form?.get("audio");
    if (!(file instanceof File) || file.size === 0) {
      return fail("No audio file provided", 400);
    }
    if (file.size > MAX_AUDIO_BYTES) {
      return fail("Audio is too large (max 25MB)", 413);
    }

    const text = await transcribeVoiceNote(file);
    return ok({ text });
  } catch (error) {
    const message = (error as Error).message || "Transcription failed";
    logError("Voice note transcription failed", { error: message });
    return fail(message, 500);
  }
}
