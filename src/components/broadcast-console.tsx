"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { BroadcastAudienceCategory, BroadcastPreviewRoute } from "@/lib/types";

type Employee = {
  id: string;
  full_name: string;
  whatsapp_e164: string;
  department: string | null;
  designation: string | null;
  is_active: boolean;
  tags?: Array<{ key: string; label: string }>;
};

type PreviewResponse = {
  recipients: Employee[];
  routes: BroadcastPreviewRoute[];
  mentionMatches: Array<{ employeeId: string; fullName: string; confidence: number; reason: string }>;
  unresolvedMentions: string[];
  unresolvedAiTargets: string[];
  enhancedMessage: string;
  aiDiagnostics?: {
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
      mode: "rewrite" | "compose" | "regenerate";
      detectedInstruction: boolean;
    };
  };
};

type BroadcastSendFailure = {
  employeeName?: string;
  reason?: string;
  languageCode?: string;
  templateVariant?: string;
};

type BroadcastConsoleProps = {
  initialEmployees: Employee[];
  templateName: string;
};

type TargetMode = "mixed" | "group" | "custom";
type ToastKind = "success" | "error" | "info";
type GroupAudience = Exclude<BroadcastAudienceCategory, "custom">;

type ToastItem = {
  id: number;
  kind: ToastKind;
  title: string;
  message: string;
};

const targetModeOptions: Array<{ value: TargetMode; label: string }> = [
  { value: "mixed", label: "Mixed (AI)" },
  { value: "group", label: "Group" },
  { value: "custom", label: "Custom Members" },
];

const groupAudienceOptions: Array<{ value: GroupAudience; label: string }> = [
  { value: "all", label: "All" },
  { value: "sales_team", label: "Sales" },
  { value: "head_office", label: "Head Office" },
  { value: "drivers", label: "Drivers" },
  { value: "customers", label: "Customers" },
];

const groupTagMap: Record<Exclude<GroupAudience, "all">, string> = {
  sales_team: "sales_field",
  head_office: "head_office",
  drivers: "drivers",
  customers: "customers",
};

const PREVIEW_REQUEST_TIMEOUT_MS = 25000;
const PREVIEW_MAX_RETRIES = 1;

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripLeadingTargetName(value: string, targetLabel: string): string {
  const name = targetLabel.trim();
  if (!name) return value.trim();
  const pattern = new RegExp(
    `^${escapeRegExp(name)}(?:\\s*(?:[,:;.!?\\u2013\\u2014\\u0964-])\\s*|\\s+)`,
    "iu",
  );
  const cleaned = value.trim().replace(pattern, "").trim();
  return cleaned || value.trim();
}

function routeMessageForEditor(route: BroadcastPreviewRoute): string {
  const message = route.instruction.trim();
  if (!message) return "";
  if (route.source === "ai_person") {
    return stripLeadingTargetName(message, route.targetLabel);
  }
  return message;
}

function deriveEditorMessageFromPreview(
  preview: PreviewResponse,
  fallbackMessage: string,
  targetMode: TargetMode,
): string {
  const activeRoutes = preview.routes.filter((route) => route.recipientEmployeeIds.length > 0);
  if (activeRoutes.length === 0) {
    return (preview.enhancedMessage || fallbackMessage).trim();
  }

  const routeMessages = activeRoutes
    .map((route) => routeMessageForEditor(route))
    .filter(Boolean);

  if (routeMessages.length === 0) {
    return (preview.enhancedMessage || fallbackMessage).trim();
  }

  const normalizedUnique = Array.from(new Set(routeMessages.map((item) => collapseWhitespace(item))));
  if (normalizedUnique.length === 1) {
    return routeMessages[0];
  }

  if (targetMode === "group" || targetMode === "custom") {
    return routeMessages[0];
  }

  return (preview.enhancedMessage || fallbackMessage).trim();
}

function employeeMatchesQuery(employee: Employee, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    employee.full_name.toLowerCase().includes(q) ||
    employee.whatsapp_e164.toLowerCase().includes(q) ||
    String(employee.department || "").toLowerCase().includes(q) ||
    String(employee.designation || "").toLowerCase().includes(q)
  );
}

function networkErrorMessage(error: unknown): string {
  const text = ((error as Error)?.message ?? "").trim();
  if (text.toLowerCase().includes("aborted") || text.toLowerCase().includes("timeout")) {
    return "Preview request timed out. Please retry.";
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "You appear offline. Check internet and retry.";
  }
  return text || "Network error. Please retry.";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function fetchJsonWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function isEmployeeInAudience(employee: Employee, audience: GroupAudience): boolean {
  if (audience === "all") return true;
  const tagKey = groupTagMap[audience];
  return (employee.tags ?? []).some((tag) => tag.key === tagKey);
}

function previewWarnings(preview: PreviewResponse | null): string[] {
  if (!preview?.aiDiagnostics) return [];

  const warnings: string[] = [];
  const route = preview.aiDiagnostics.routeExtraction;
  const mention = preview.aiDiagnostics.mentionExtraction;
  const rewrite = preview.aiDiagnostics.messageRewrite;

  if (route.enabled && route.usedFallback) {
    warnings.push(`Route AI fallback: ${route.error || "AI route extraction unavailable"}`);
  }

  if (mention.enabled && mention.usedFallback) {
    warnings.push(`Mention AI fallback: ${mention.error || "AI mention extraction unavailable"}`);
  }

  if (rewrite.usedFallback) {
    warnings.push(`Draft AI fallback: ${rewrite.error || "AI drafting unavailable"}`);
  }

  return warnings;
}

function draftModeLabel(preview: PreviewResponse | null): string {
  const mode = preview?.aiDiagnostics?.messageRewrite.mode;
  if (mode === "compose") return "AI drafted";
  if (mode === "regenerate") return "AI regenerated";
  return "AI refined";
}

export function BroadcastConsole({ initialEmployees, templateName }: BroadcastConsoleProps) {
  const [message, setMessage] = useState("");
  const [targetMode, setTargetMode] = useState<TargetMode>("mixed");
  const [groupAudience, setGroupAudience] = useState<GroupAudience>("all");
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const [groupSearch, setGroupSearch] = useState("");
  const [groupExcludedByAudience, setGroupExcludedByAudience] = useState<Record<GroupAudience, string[]>>({
    all: [],
    sales_team: [],
    head_office: [],
    drivers: [],
    customers: [],
  });
  const [search, setSearch] = useState("");

  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewAudienceCategory, setPreviewAudienceCategory] = useState<BroadcastAudienceCategory>("all");
  const [reviewedMessage, setReviewedMessage] = useState("");
  const [previewGeneratedAt, setPreviewGeneratedAt] = useState("");
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [regenerateInstruction, setRegenerateInstruction] = useState("");

  const [status, setStatus] = useState("Ready.");
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toastCounterRef = useRef(0);

  const busy = previewing || sending;

  const filteredEmployees = useMemo(() => {
    return initialEmployees.filter((employee) => employeeMatchesQuery(employee, search));
  }, [initialEmployees, search]);

  const groupMembers = useMemo(
    () => initialEmployees.filter((employee) => isEmployeeInAudience(employee, groupAudience)),
    [initialEmployees, groupAudience],
  );

  const groupExcludedIds = useMemo(
    () => new Set(groupExcludedByAudience[groupAudience] ?? []),
    [groupAudience, groupExcludedByAudience],
  );

  const filteredGroupMembers = useMemo(
    () => groupMembers.filter((employee) => employeeMatchesQuery(employee, groupSearch)),
    [groupMembers, groupSearch],
  );

  const selectedGroupEmployeeIds = useMemo(
    () => groupMembers.filter((employee) => !groupExcludedIds.has(employee.id)).map((employee) => employee.id),
    [groupExcludedIds, groupMembers],
  );

  const previewRecipientCount = preview?.recipients.length ?? 0;
  const previewRouteCount = preview?.routes.length ?? 0;
  const aiWarnings = previewWarnings(preview);

  useEffect(() => {
    if (!previewModalOpen) return;

    function onEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !sending) {
        setPreviewModalOpen(false);
      }
    }

    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [previewModalOpen, sending]);

  function pushToast(kind: ToastKind, title: string, toastMessage: string): void {
    toastCounterRef.current += 1;
    const id = toastCounterRef.current;

    setToasts((prev) => [...prev, { id, kind, title, message: toastMessage }].slice(-4));

    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 4200);
  }

  function toggleEmployee(id: string, checked: boolean): void {
    setSelectedEmployeeIds((prev) =>
      checked ? dedupe([...prev, id]) : prev.filter((item) => item !== id),
    );
  }

  function toggleGroupEmployee(id: string, checked: boolean): void {
    setGroupExcludedByAudience((prev) => {
      const next = new Set(prev[groupAudience] ?? []);
      if (checked) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return {
        ...prev,
        [groupAudience]: Array.from(next),
      };
    });
  }

  function selectAllGroupMembers(): void {
    setGroupExcludedByAudience((prev) => ({
      ...prev,
      [groupAudience]: [],
    }));
  }

  function clearAllGroupMembers(): void {
    setGroupExcludedByAudience((prev) => ({
      ...prev,
      [groupAudience]: groupMembers.map((employee) => employee.id),
    }));
  }

  function selectFilteredGroupMembers(): void {
    const filteredSet = new Set(filteredGroupMembers.map((employee) => employee.id));
    setGroupExcludedByAudience((prev) => {
      const retainedExcluded = (prev[groupAudience] ?? []).filter((id) => !filteredSet.has(id));
      return {
        ...prev,
        [groupAudience]: retainedExcluded,
      };
    });
  }

  function buildPreviewPayload(useAiRoutingOverride?: boolean) {
    const override = typeof useAiRoutingOverride === "boolean" ? useAiRoutingOverride : null;

    if (targetMode === "custom") {
      return {
        audienceCategory: "custom" as BroadcastAudienceCategory,
        selectedEmployeeIds,
        useAiRouting: override ?? false,
        lockToSelectedRecipients: false,
      };
    }

    if (targetMode === "group") {
      return {
        audienceCategory: groupAudience as BroadcastAudienceCategory,
        selectedEmployeeIds: selectedGroupEmployeeIds,
        useAiRouting: override ?? false,
        lockToSelectedRecipients: true,
      };
    }

    return {
      audienceCategory: "custom" as BroadcastAudienceCategory,
      selectedEmployeeIds: [] as string[],
      useAiRouting: override ?? true,
      lockToSelectedRecipients: false,
    };
  }

  function buildReviewedRoutesForSend(previewPayload: PreviewResponse, finalMessage: string) {
    return previewPayload.routes
      .filter((route) => route.recipientEmployeeIds.length > 0)
      .map((route) => ({
        routeId: route.routeId,
        targetLabel: route.targetLabel,
        source: route.source,
        recipientEmployeeIds: route.recipientEmployeeIds,
        message:
          route.source === "ai_person" || route.source === "ai_group"
            ? (route.instruction.trim() || finalMessage)
            : finalMessage,
      }));
  }

  function applySendResponse(json: Record<string, unknown>) {
    const accepted = Number(
      (json as { accepted?: number; sent?: number }).accepted ??
        (json as { sent?: number }).sent ??
        0,
    );
    const failed = Number((json as { failed?: number }).failed ?? 0);
    const failureDetails = ((json as { failureDetails?: BroadcastSendFailure[] }).failureDetails ?? []).filter(
      (item) => item.reason,
    );
    const failurePreview = failureDetails[0];

    if (failed > 0 && failurePreview) {
      const partialMessage = `Campaign ${(json as { campaignId: string }).campaignId}: accepted=${accepted}, failed=${failed}. First error for ${failurePreview.employeeName || "recipient"}: ${failurePreview.reason}${failurePreview.languageCode ? ` (lang: ${failurePreview.languageCode})` : ""}${failurePreview.templateVariant ? ` (variant: ${failurePreview.templateVariant})` : ""}`;
      setStatus(partialMessage);
      pushToast("info", "Broadcast sent with failures", `Accepted: ${accepted}, Failed: ${failed}`);
      return;
    }

    const successMessage = `Campaign ${(json as { campaignId: string }).campaignId}: accepted=${accepted}, failed=${failed}.`;
    setStatus(successMessage);
    pushToast("success", "Broadcast sent", `Successfully queued ${accepted} messages.`);
    setPreviewModalOpen(false);
  }

  async function requestPreview(options?: {
    useAiRoutingOverride?: boolean;
    messageOverride?: string;
    previousDraft?: string;
    aiRegenerateInstruction?: string;
    preferInstructionMode?: boolean;
    loadingStatus?: string;
  }): Promise<void> {
    const trimmedMessage = (options?.messageOverride ?? message).trim();
    if (!trimmedMessage) {
      setStatus("Write a message or instruction before generating preview.");
      pushToast("error", "Message required", "Please write the CEO message or instruction first.");
      return;
    }

    const payload = buildPreviewPayload(options?.useAiRoutingOverride);

    setPreviewing(true);
    setStatus(options?.loadingStatus || "Generating AI preview...");

    try {
      const requestBody = JSON.stringify({
        message: trimmedMessage,
        audienceCategory: payload.audienceCategory,
        selectedEmployeeIds: payload.selectedEmployeeIds,
        selectedTagKeys: [],
        useAiRouting: payload.useAiRouting,
        lockToSelectedRecipients: payload.lockToSelectedRecipients,
        previousDraft: options?.previousDraft ?? "",
        aiRegenerateInstruction: options?.aiRegenerateInstruction ?? "",
        preferInstructionMode: options?.preferInstructionMode ?? false,
      });

      let res: Response | null = null;
      let lastNetworkError: unknown = null;
      for (let attempt = 0; attempt <= PREVIEW_MAX_RETRIES; attempt += 1) {
        try {
          res = await fetchJsonWithTimeout(
            "/api/broadcasts/preview",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: requestBody,
            },
            PREVIEW_REQUEST_TIMEOUT_MS,
          );
          break;
        } catch (error) {
          lastNetworkError = error;
          if (attempt >= PREVIEW_MAX_RETRIES) break;
          await delay(450);
        }
      }

      if (!res) {
        throw lastNetworkError ?? new Error("Preview request failed");
      }

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errorMessage = (json as { error?: string }).error ?? "Preview failed.";
        setStatus(errorMessage);
        pushToast("error", "Preview failed", errorMessage);
        return;
      }

      const parsed = json as PreviewResponse;
      setPreview(parsed);
      setPreviewAudienceCategory(payload.audienceCategory);
      setReviewedMessage(deriveEditorMessageFromPreview(parsed, trimmedMessage, targetMode));
      setPreviewGeneratedAt(new Date().toLocaleString());
      setPreviewModalOpen(true);
      setRegenerateInstruction("");

      const warnings = previewWarnings(parsed);
      if (warnings.length > 0) {
        setStatus(`Preview ready with AI fallback: ${warnings[0]}`);
        pushToast("info", "Preview ready with fallback", warnings[0]);
      } else {
        const modeText = draftModeLabel(parsed);
        setStatus(`${modeText}: ${parsed.recipients.length} recipient(s), ${parsed.routes.length} route(s).`);
        pushToast("success", "Preview ready", `${modeText} for ${parsed.recipients.length} recipients.`);
      }
    } catch (error) {
      const msg = networkErrorMessage(error);
      setStatus(msg);
      pushToast("error", "Network error", msg);
    } finally {
      setPreviewing(false);
    }
  }

  async function onPreview(event: FormEvent) {
    event.preventDefault();

    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      setStatus("Write a message or instruction before generating preview.");
      pushToast("error", "Message required", "Please write the CEO message or instruction first.");
      return;
    }

    if (targetMode === "custom" && selectedEmployeeIds.length === 0) {
      setStatus("Pick at least one member for custom broadcast.");
      pushToast("error", "No recipients", "Select at least one member for custom broadcast.");
      return;
    }

    if (targetMode === "group" && selectedGroupEmployeeIds.length === 0) {
      setStatus("Pick at least one member from the selected group.");
      pushToast("error", "No recipients", "Select at least one group member for broadcast.");
      return;
    }

    await requestPreview();
  }

  async function onRegeneratePreview() {
    if (!preview) {
      setStatus("Generate preview first.");
      pushToast("error", "Preview missing", "Please generate preview first.");
      return;
    }

    const reinstruction = regenerateInstruction.trim();
    if (!reinstruction) {
      setStatus("Write a reinstruction before regenerating.");
      pushToast("error", "Instruction required", "Add a reinstruction for AI regeneration.");
      return;
    }

    await requestPreview({
      messageOverride: message.trim() || reviewedMessage.trim() || preview.enhancedMessage,
      previousDraft: reviewedMessage.trim() || preview.enhancedMessage || message.trim(),
      aiRegenerateInstruction: reinstruction,
      preferInstructionMode: true,
      loadingStatus: "Regenerating AI preview...",
    });
  }

  async function onSend() {
    if (!preview) {
      setStatus("Generate preview first.");
      pushToast("error", "Preview missing", "Please generate preview before sending.");
      return;
    }

    const finalMessage = reviewedMessage.trim() || message.trim();
    if (!finalMessage) {
      setStatus("Final message is empty.");
      pushToast("error", "Final message empty", "Please enter a final message before sending.");
      return;
    }

    const reviewedRoutes = buildReviewedRoutesForSend(preview, finalMessage);

    if (reviewedRoutes.length === 0) {
      setStatus("No valid recipients in preview routes.");
      pushToast("error", "No valid recipients", "Preview did not resolve any recipients to send.");
      return;
    }

    setSending(true);
    setStatus("Sending broadcast...");

    try {
      const res = await fetch("/api/broadcasts/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalMessage: message.trim(),
          finalMessage,
          audienceCategory: previewAudienceCategory,
          reviewedRoutes,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errorMessage = (json as { error?: string }).error ?? "Broadcast failed.";
        setStatus(errorMessage);
        pushToast("error", "Broadcast failed", errorMessage);
        return;
      }

      applySendResponse(json as Record<string, unknown>);
    } catch (error) {
      const msg = networkErrorMessage(error);
      setStatus(msg);
      pushToast("error", "Network error", msg);
    } finally {
      setSending(false);
    }
  }

  async function onSendWithoutPreview() {
    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      setStatus("Write a message before sending.");
      pushToast("error", "Message required", "Please write the CEO message first.");
      return;
    }

    if (targetMode === "mixed") {
      setStatus("Mixed mode requires AI preview before send.");
      pushToast("info", "Preview required", "Mixed (AI) mode must use preview before send.");
      return;
    }

    if (targetMode === "custom" && selectedEmployeeIds.length === 0) {
      setStatus("Pick at least one member for custom broadcast.");
      pushToast("error", "No recipients", "Select at least one member for custom broadcast.");
      return;
    }

    if (targetMode === "group" && selectedGroupEmployeeIds.length === 0) {
      setStatus("Pick at least one member from the selected group.");
      pushToast("error", "No recipients", "Select at least one group member for broadcast.");
      return;
    }

    setSending(true);
    setStatus("Sending without AI preview...");

    const payload = buildPreviewPayload();

    try {
      const previewRes = await fetch("/api/broadcasts/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmedMessage,
          audienceCategory: payload.audienceCategory,
          selectedEmployeeIds: payload.selectedEmployeeIds,
          selectedTagKeys: [],
          useAiRouting: false,
          lockToSelectedRecipients: payload.lockToSelectedRecipients,
        }),
      });

      const previewJson = await previewRes.json().catch(() => ({}));
      if (!previewRes.ok) {
        const errorMessage = (previewJson as { error?: string }).error ?? "Recipient resolution failed.";
        setStatus(errorMessage);
        pushToast("error", "Send failed", errorMessage);
        return;
      }

      const parsed = previewJson as PreviewResponse;
      const reviewedRoutes = buildReviewedRoutesForSend(parsed, trimmedMessage);

      if (reviewedRoutes.length === 0) {
        setStatus("No valid recipients available for send.");
        pushToast("error", "No recipients", "No valid recipients available for selected audience.");
        return;
      }

      const sendRes = await fetch("/api/broadcasts/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalMessage: trimmedMessage,
          finalMessage: trimmedMessage,
          audienceCategory: payload.audienceCategory,
          reviewedRoutes,
        }),
      });

      const sendJson = await sendRes.json().catch(() => ({}));
      if (!sendRes.ok) {
        const errorMessage = (sendJson as { error?: string }).error ?? "Broadcast failed.";
        setStatus(errorMessage);
        pushToast("error", "Broadcast failed", errorMessage);
        return;
      }

      applySendResponse(sendJson as Record<string, unknown>);
    } catch (error) {
      const msg = networkErrorMessage(error);
      setStatus(msg);
      pushToast("error", "Network error", msg);
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="grid broadcast-console" style={{ gap: 14 }}>
      <article className="panel status-banner broadcast-status-banner">
        <div className="inline" style={{ justifyContent: "space-between", width: "100%" }}>
          <div className="inline">
            {busy ? <span className="status-spinner" aria-hidden="true" /> : null}
            <strong>{sending ? "Sending..." : previewing ? "Generating Preview..." : "Broadcast Status"}</strong>
          </div>
          <span className="muted">{status}</span>
        </div>
      </article>

      <article className="card grid broadcast-station" style={{ gap: 14 }}>
        <div className="inline" style={{ justifyContent: "space-between" }}>
          <h2>CEO Broadcast Station</h2>
          <span className="pill">Template: {templateName}</span>
        </div>

        <form className="grid broadcast-form" onSubmit={onPreview} style={{ gap: 14 }}>
          <label className="grid broadcast-draft" style={{ gap: 6 }}>
            <span className="muted" style={{ fontWeight: 700 }}>1. Message or AI Instruction</span>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Write direct message or instruct AI (e.g. Ami sales team ke ekta motivational message dite chai)."
              style={{ minHeight: 130 }}
              required
            />
            <span className="muted">
              You can write exact broadcast text or simply instruct AI to draft it for you.
            </span>
          </label>

          <article className="panel grid broadcast-audience" style={{ gap: 10 }}>
            <div className="inline broadcast-audience-head" style={{ justifyContent: "space-between" }}>
              <span className="muted" style={{ fontWeight: 700 }}>2. Choose Audience</span>
              <div className="inline">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void onSendWithoutPreview()}
                  disabled={busy || targetMode === "mixed"}
                  title={targetMode === "mixed" ? "Mixed mode requires AI preview" : "Send directly without opening preview"}
                >
                  {sending ? "Sending..." : "Send Without AI Preview"}
                </button>
                <button type="submit" disabled={busy}>
                  {previewing ? "Generating..." : "Generate AI Preview"}
                </button>
              </div>
            </div>

            <div className="inline broadcast-target-modes">
              {targetModeOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={targetMode === option.value ? "" : "ghost"}
                  onClick={() => setTargetMode(option.value)}
                  disabled={busy}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {targetMode === "custom" ? (
              <div className="grid broadcast-custom-members" style={{ gap: 8 }}>
                <div className="inline" style={{ justifyContent: "space-between" }}>
                  <strong>Custom Member Selection</strong>
                  <span className="muted">Selected: {selectedEmployeeIds.length}</span>
                </div>

                <input
                  className="input"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by name, number, department, designation"
                />

                <div className="inline">
                  <button
                    className="ghost"
                    type="button"
                    onClick={() => setSelectedEmployeeIds(filteredEmployees.map((item) => item.id))}
                    disabled={busy}
                  >
                    Select Filtered
                  </button>
                  <button
                    className="ghost"
                    type="button"
                    onClick={() => setSelectedEmployeeIds(initialEmployees.map((item) => item.id))}
                    disabled={busy}
                  >
                    Select All
                  </button>
                  <button
                    className="ghost"
                    type="button"
                    onClick={() => setSelectedEmployeeIds([])}
                    disabled={busy}
                  >
                    Clear
                  </button>
                  <span className="muted">Showing: {filteredEmployees.length}</span>
                </div>

                <div className="table-wrap broadcast-custom-table" style={{ maxHeight: 340, overflowY: "auto" }}>
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: 70 }}>Pick</th>
                        <th style={{ minWidth: 240 }}>Name</th>
                        <th style={{ minWidth: 170 }}>Department</th>
                        <th style={{ minWidth: 190 }}>Designation</th>
                        <th style={{ minWidth: 170 }}>WhatsApp</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEmployees.map((employee) => (
                        <tr key={employee.id}>
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedEmployeeIds.includes(employee.id)}
                              onChange={(event) => toggleEmployee(employee.id, event.target.checked)}
                            />
                          </td>
                          <td>{employee.full_name}</td>
                          <td>{employee.department || "-"}</td>
                          <td>{employee.designation || "-"}</td>
                          <td>{employee.whatsapp_e164}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : targetMode === "group" ? (
              <div className="grid broadcast-group-mode" style={{ gap: 8 }}>
                <div className="inline" style={{ justifyContent: "space-between" }}>
                  <strong>Group Category</strong>
                  <span className="muted">
                    Selected: {selectedGroupEmployeeIds.length} / {groupMembers.length}
                  </span>
                </div>

                <div className="inline broadcast-group-categories">
                  {groupAudienceOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={groupAudience === option.value ? "" : "ghost"}
                      onClick={() => setGroupAudience(option.value)}
                      disabled={busy}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <input
                  className="input"
                  value={groupSearch}
                  onChange={(event) => setGroupSearch(event.target.value)}
                  placeholder="Search members in this group"
                />

                <div className="inline">
                  <button type="button" className="ghost" onClick={() => selectFilteredGroupMembers()} disabled={busy}>
                    Select Filtered
                  </button>
                  <button type="button" className="ghost" onClick={() => selectAllGroupMembers()} disabled={busy}>
                    Select All
                  </button>
                  <button type="button" className="ghost" onClick={() => clearAllGroupMembers()} disabled={busy}>
                    Clear All
                  </button>
                  <span className="muted">Showing: {filteredGroupMembers.length}</span>
                </div>

                <div className="table-wrap broadcast-group-table" style={{ maxHeight: 320, overflowY: "auto" }}>
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: 70 }}>Pick</th>
                        <th style={{ minWidth: 240 }}>Name</th>
                        <th style={{ minWidth: 170 }}>Department</th>
                        <th style={{ minWidth: 190 }}>Designation</th>
                        <th style={{ minWidth: 170 }}>WhatsApp</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredGroupMembers.map((employee) => (
                        <tr key={employee.id}>
                          <td>
                            <input
                              type="checkbox"
                              checked={!groupExcludedIds.has(employee.id)}
                              onChange={(event) => toggleGroupEmployee(employee.id, event.target.checked)}
                            />
                          </td>
                          <td>{employee.full_name}</td>
                          <td>{employee.department || "-"}</td>
                          <td>{employee.designation || "-"}</td>
                          <td>{employee.whatsapp_e164}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <span className="muted">
                  Group preview will include only selected members from this category.
                </span>
              </div>
            ) : (
              <div className="grid broadcast-mixed-mode" style={{ gap: 8 }}>
                <span className="muted">
                  AI-only targeting is active. Recipients will come from names/groups identified in your message or instruction.
                </span>
                <span className="muted">
                  No category auto-selection is applied in Mixed mode.
                </span>
              </div>
            )}
          </article>
        </form>
      </article>

      {previewModalOpen && preview ? (
        <div className="broadcast-modal-backdrop" role="dialog" aria-modal="true">
          <article className="broadcast-modal">
            <div className="broadcast-modal-head">
              <div>
                <h2>AI Preview</h2>
                <p className="muted" style={{ margin: 0 }}>
                  Structured message preview before final send
                  {previewGeneratedAt ? ` | ${previewGeneratedAt}` : ""}
                </p>
              </div>
              <button
                type="button"
                className="ghost"
                onClick={() => setPreviewModalOpen(false)}
                disabled={sending}
              >
                Close
              </button>
            </div>

            <div className="broadcast-modal-metrics">
              <article className="broadcast-metric-card">
                <p className="kpi-label">Recipients</p>
                <p className="kpi-value" style={{ fontSize: 24 }}>{previewRecipientCount}</p>
              </article>
              <article className="broadcast-metric-card">
                <p className="kpi-label">Routes</p>
                <p className="kpi-value" style={{ fontSize: 24 }}>{previewRouteCount}</p>
              </article>
              <article className="broadcast-metric-card">
                <p className="kpi-label">Template</p>
                <p className="kpi-sub" style={{ color: "#14395e", fontWeight: 700 }}>{templateName}</p>
              </article>
              <article className="broadcast-metric-card">
                <p className="kpi-label">AI Mode</p>
                <p className="kpi-sub" style={{ color: "#14395e", fontWeight: 700 }}>{draftModeLabel(preview)}</p>
              </article>
            </div>

            <label className="grid" style={{ gap: 6 }}>
              <span>Final Message (Editable)</span>
              <textarea
                value={reviewedMessage}
                onChange={(event) => setReviewedMessage(event.target.value)}
                style={{ minHeight: 180 }}
              />
            </label>

            <div className="panel grid" style={{ gap: 8 }}>
              <label className="grid" style={{ gap: 6 }}>
                <span>Re-instruct AI (Optional)</span>
                <textarea
                  value={regenerateInstruction}
                  onChange={(event) => setRegenerateInstruction(event.target.value)}
                  placeholder="Example: make it shorter, more friendly, and focus on customer follow-up."
                  style={{ minHeight: 92 }}
                />
              </label>
              <div className="inline" style={{ justifyContent: "space-between" }}>
                <span className="muted">Use reinstruction to regenerate this preview before sending.</span>
                <button type="button" className="ghost" onClick={() => void onRegeneratePreview()} disabled={busy}>
                  {previewing ? "Regenerating..." : "Regenerate Preview"}
                </button>
              </div>
            </div>

            <div className="table-wrap" style={{ maxHeight: 240, overflowY: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ minWidth: 220 }}>Target</th>
                    <th style={{ minWidth: 140 }}>Source</th>
                    <th style={{ minWidth: 140 }}>Recipients</th>
                    <th style={{ minWidth: 120 }}>Confidence</th>
                    <th style={{ minWidth: 260 }}>Route Message</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.routes.map((route) => (
                    <tr key={route.routeId}>
                      <td>{route.targetLabel}</td>
                      <td>{route.source}</td>
                      <td>{route.recipientEmployeeIds.length}</td>
                      <td>{Math.round(route.confidence * 100)}%</td>
                      <td>{route.instruction}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {preview.unresolvedMentions.length ? (
              <p className="muted">Unresolved mentions: {preview.unresolvedMentions.join(", ")}</p>
            ) : null}
            {preview.unresolvedAiTargets.length ? (
              <p className="muted">Unresolved AI targets: {preview.unresolvedAiTargets.join(", ")}</p>
            ) : null}
            {aiWarnings.length ? (
              <p className="muted">AI diagnostics: {aiWarnings.join(" | ")}</p>
            ) : null}

            <div className="inline" style={{ justifyContent: "space-between" }}>
              <span className="muted">Confirm and send this message.</span>
              <button type="button" onClick={() => void onSend()} disabled={busy}>
                {sending ? "Sending..." : "Confirm & Send"}
              </button>
            </div>
          </article>
        </div>
      ) : null}

      {toasts.length > 0 ? (
        <div className="toast-stack" aria-live="polite" aria-atomic="false">
          {toasts.map((toast) => (
            <article key={toast.id} className={`toast-card toast-${toast.kind}`}>
              <strong>{toast.title}</strong>
              <p>{toast.message}</p>
            </article>
          ))}
        </div>
      ) : null}

      {busy ? (
        <div className="broadcast-busy-overlay" aria-live="polite">
          <div className="broadcast-busy-card">
            <span className="status-spinner status-spinner-lg" aria-hidden="true" />
            <strong>{previewing ? "Generating preview" : "Sending broadcast"}</strong>
            <p>{previewing ? "AI is preparing a structured preview..." : "Your broadcast is being queued now..."}</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
