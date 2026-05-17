import { randomUUID } from "node:crypto";
import { enhanceCeoMessageWithMeta, extractInstructionRoutesWithMeta } from "@/lib/ai";
import type { AiInstructionRoute } from "@/lib/ai";
import { resolveMentions, resolvePersonNameTarget } from "@/lib/mention";
import type {
  BroadcastAudienceCategory,
  BroadcastPreviewRoute,
  BroadcastRouteSource,
  BroadcastRouteTargetType,
} from "@/lib/types";

type TagLike = {
  key: string;
  label: string;
};

type EmployeeLike = {
  id: string;
  full_name: string;
  aliases?: string[];
  is_active: boolean;
  tags?: TagLike[];
};

type BuildPreviewInput = {
  message: string;
  audienceCategory: BroadcastAudienceCategory;
  selectedEmployeeIds: string[];
  selectedTagKeys: string[];
  useAiRouting: boolean;
};

type RouteFlags = {
  usedManualSelection: boolean;
  usedTagSelection: boolean;
  usedCategorySelection: boolean;
  usedMentions: boolean;
};

export type BroadcastPreviewBuildResult = {
  routes: BroadcastPreviewRoute[];
  recipients: string[];
  extractedMentionNames: string[];
  mentionMatches: Array<{ employeeId: string; fullName: string; confidence: number; reason: string }>;
  unresolvedMentions: string[];
  unresolvedAiTargets: string[];
  enhancedMessage: string;
  aiDiagnostics: {
    routeExtraction: {
      usedFallback: boolean;
      error: string | null;
      enabled: boolean;
    };
    mentionExtraction: {
      usedFallback: boolean;
      error: string | null;
      enabled: boolean;
    };
    messageRewrite: {
      usedFallback: boolean;
      error: string | null;
    };
  };
};

function isQuotaError(message: string | null | undefined): boolean {
  const value = String(message ?? "").toLowerCase();
  return value.includes("429") || value.includes("quota") || value.includes("rate limit");
}

const CATEGORY_TO_TAG: Record<Exclude<BroadcastAudienceCategory, "all" | "custom">, string> = {
  sales_team: "sales_field",
  head_office: "head_office",
  drivers: "drivers",
  customers: "customers",
};

function normalizeCategory(input: string): BroadcastAudienceCategory | null {
  const value = input.trim().toLowerCase();
  if (["sales", "sales_team", "sales field", "field sales"].includes(value)) return "sales_team";
  if (["head_office", "head office", "ho", "office"].includes(value)) return "head_office";
  if (["drivers", "driver"].includes(value)) return "drivers";
  if (["customer", "customers", "client", "clients"].includes(value)) return "customers";
  if (["all", "everyone", "whole team"].includes(value)) return "all";
  if (["custom"].includes(value)) return "custom";
  return null;
}

function dedupeIds(ids: string[]): string[] {
  return Array.from(new Set(ids));
}

function employeeHasAnyTag(employee: EmployeeLike, tagKeys: string[]): boolean {
  const set = new Set((employee.tags ?? []).map((tag) => tag.key));
  return tagKeys.some((key) => set.has(key));
}

function recipientsFromCategory(category: BroadcastAudienceCategory, employees: EmployeeLike[]): string[] {
  if (category === "custom") return [];
  if (category === "all") return employees.filter((employee) => employee.is_active).map((employee) => employee.id);
  const tagKey = CATEGORY_TO_TAG[category];
  return employees
    .filter((employee) => employee.is_active && employeeHasAnyTag(employee, [tagKey]))
    .map((employee) => employee.id);
}

function audienceLabel(category: BroadcastAudienceCategory): string {
  if (category === "sales_team") return "Sales Team";
  if (category === "head_office") return "Head Office";
  if (category === "drivers") return "Drivers";
  if (category === "customers") return "Customers";
  if (category === "all") return "All Team Members";
  return "Custom Selection";
}

function sourceFromFlags(flags: RouteFlags): BroadcastRouteSource {
  if (flags.usedMentions && (flags.usedTagSelection || flags.usedManualSelection || flags.usedCategorySelection)) {
    return "mixed";
  }
  if (flags.usedMentions) return "mention";
  if (flags.usedTagSelection || flags.usedCategorySelection) return "tag";
  return "manual";
}

function makeRoute(input: {
  instruction: string;
  targetType: BroadcastRouteTargetType;
  targetLabel: string;
  source: BroadcastRouteSource;
  confidence: number;
  recipientEmployeeIds: string[];
  unresolvedTargets?: string[];
}): BroadcastPreviewRoute {
  return {
    routeId: randomUUID(),
    instruction: input.instruction,
    targetType: input.targetType,
    targetLabel: input.targetLabel,
    source: input.source,
    confidence: Number(input.confidence.toFixed(2)),
    recipientEmployeeIds: dedupeIds(input.recipientEmployeeIds),
    unresolvedTargets: input.unresolvedTargets ?? [],
  };
}

export async function buildBroadcastPreview(
  input: BuildPreviewInput,
  employees: EmployeeLike[],
): Promise<BroadcastPreviewBuildResult> {
  const activeEmployees = employees.filter((employee) => employee.is_active);
  const activeById = new Map(activeEmployees.map((employee) => [employee.id, employee]));
  const mentionAiEnabled = false;

  const selectedIds = dedupeIds(input.selectedEmployeeIds).filter((id) => activeById.has(id));
  const tagIds = activeEmployees
    .filter((employee) => employeeHasAnyTag(employee, input.selectedTagKeys))
    .map((employee) => employee.id);
  const categoryIds = recipientsFromCategory(input.audienceCategory, activeEmployees);

  const baseRecipientIds = dedupeIds([...selectedIds, ...tagIds, ...categoryIds]);

  const aiRouteResult = input.useAiRouting
    ? await extractInstructionRoutesWithMeta(input.message)
    : {
        routes: [] as AiInstructionRoute[],
        meta: { usedFallback: false, error: null },
      };
  const aiRoutes = aiRouteResult.routes;

  const mentionResult = await resolveMentions(input.message, activeEmployees, {
    useAiExtraction: mentionAiEnabled,
  });
  const mentionIds = dedupeIds(mentionResult.matches.map((match) => match.employeeId));

  const previewRoutes: BroadcastPreviewRoute[] = [];
  const unresolvedAiTargets: string[] = [];
  const coveredByAi = new Set<string>();

  for (const route of aiRoutes) {
    if (route.targetType === "group") {
      const category = normalizeCategory(route.target);
      const recipients = category
        ? recipientsFromCategory(category, activeEmployees)
        : activeEmployees
            .filter((employee) => employeeHasAnyTag(employee, [route.target.trim().toLowerCase()]))
            .map((employee) => employee.id);

      const ids = dedupeIds(recipients);
      if (ids.length === 0) {
        unresolvedAiTargets.push(route.target);
      }

      for (const id of ids) coveredByAi.add(id);

      previewRoutes.push(
        makeRoute({
          instruction: route.message,
          targetType: "group",
          targetLabel: category ? audienceLabel(category) : route.target,
          source: "ai_group",
          confidence: route.confidence,
          recipientEmployeeIds: ids,
          unresolvedTargets: ids.length > 0 ? [] : [route.target],
        }),
      );
      continue;
    }

    const match = resolvePersonNameTarget(route.target, activeEmployees);
    const ids = match ? [match.employeeId] : [];
    if (ids.length === 0) {
      unresolvedAiTargets.push(route.target);
    }

    for (const id of ids) coveredByAi.add(id);

    previewRoutes.push(
      makeRoute({
        instruction: route.message,
        targetType: "person",
        targetLabel: match?.fullName ?? route.target,
        source: "ai_person",
        confidence: route.confidence,
        recipientEmployeeIds: ids,
        unresolvedTargets: ids.length > 0 ? [] : [route.target],
      }),
    );
  }

  const basePlusMentions = dedupeIds([...baseRecipientIds, ...mentionIds]);
  const fallbackIds = basePlusMentions.filter((id) => !coveredByAi.has(id));

  if (fallbackIds.length > 0 || previewRoutes.length === 0) {
    const flags: RouteFlags = {
      usedManualSelection: selectedIds.length > 0,
      usedTagSelection: tagIds.length > 0,
      usedCategorySelection: categoryIds.length > 0,
      usedMentions: mentionIds.length > 0,
    };

    const recipients = previewRoutes.length > 0 ? fallbackIds : basePlusMentions;

    if (recipients.length > 0) {
      previewRoutes.push(
        makeRoute({
          instruction: input.message,
          targetType: "group",
          targetLabel: audienceLabel(input.audienceCategory),
          source: sourceFromFlags(flags),
          confidence: 0.8,
          recipientEmployeeIds: recipients,
        }),
      );
    }
  }

  const recipients = dedupeIds(previewRoutes.flatMap((route) => route.recipientEmployeeIds));
  const enhancedResult = isQuotaError(aiRouteResult.meta.error)
    ? {
        text: input.message.trim(),
        meta: {
          usedFallback: true,
          error: "Skipped rewrite because AI quota is currently exceeded",
        },
      }
    : await enhanceCeoMessageWithMeta(input.message);

  return {
    routes: previewRoutes,
    recipients,
    extractedMentionNames: mentionResult.extractedNames,
    mentionMatches: mentionResult.matches,
    unresolvedMentions: mentionResult.unresolved,
    unresolvedAiTargets: dedupeIds(unresolvedAiTargets),
    enhancedMessage: enhancedResult.text,
    aiDiagnostics: {
      routeExtraction: {
        usedFallback: aiRouteResult.meta.usedFallback,
        error: aiRouteResult.meta.error,
        enabled: input.useAiRouting,
      },
      mentionExtraction: {
        usedFallback: mentionResult.aiMeta.usedFallback,
        error: mentionResult.aiMeta.error,
        enabled: mentionAiEnabled,
      },
      messageRewrite: {
        usedFallback: enhancedResult.meta.usedFallback,
        error: enhancedResult.meta.error,
      },
    },
  };
}

export function employeeLabelMap(employees: EmployeeLike[]): Map<string, string> {
  return new Map(employees.map((employee) => [employee.id, employee.full_name]));
}
