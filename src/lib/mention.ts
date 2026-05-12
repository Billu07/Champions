import { extractMentionNames } from "@/lib/ai";
import type { MentionMatch } from "@/lib/types";

type EmployeeLike = {
  id: string;
  full_name: string;
  aliases?: string[];
};

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenSet(text: string): Set<string> {
  return new Set(normalize(text).split(" ").filter(Boolean));
}

function scoreMatch(candidate: string, target: string): number {
  const a = tokenSet(candidate);
  const b = tokenSet(target);
  if (a.size === 0 || b.size === 0) return 0;

  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) overlap += 1;
  }

  return overlap / Math.max(a.size, b.size);
}

export async function resolveMentions(
  message: string,
  employees: EmployeeLike[],
): Promise<{ extractedNames: string[]; matches: MentionMatch[]; unresolved: string[] }> {
  const extractedByModel = await extractMentionNames(message);

  const explicitMentions = Array.from(
    message.matchAll(/@([a-zA-Z0-9 ._-]{2,60})/g),
    (match) => match[1].trim(),
  );

  const extractedNames = Array.from(new Set([...explicitMentions, ...extractedByModel]));

  const matches: MentionMatch[] = [];
  const unresolved: string[] = [];

  for (const rawName of extractedNames) {
    const candidates = employees
      .map((employee) => {
        const names = [employee.full_name, ...(employee.aliases ?? [])];
        const bestScore = names.reduce((best, name) => Math.max(best, scoreMatch(rawName, name)), 0);

        return {
          employee,
          score: bestScore,
        };
      })
      .sort((a, b) => b.score - a.score);

    const top = candidates[0];

    if (!top || top.score < 0.45) {
      unresolved.push(rawName);
      continue;
    }

    matches.push({
      employeeId: top.employee.id,
      fullName: top.employee.full_name,
      confidence: Number(top.score.toFixed(2)),
      reason: `Matched from mention \"${rawName}\"`,
    });
  }

  const deduped = Array.from(new Map(matches.map((item) => [item.employeeId, item])).values());

  return {
    extractedNames,
    matches: deduped,
    unresolved,
  };
}
