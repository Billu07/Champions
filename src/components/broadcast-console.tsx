"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
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

type BroadcastFailureSummary = {
  category?: string;
  owner?: "meta_compliance" | "meta_template" | "recipient_data" | "environment" | "unknown";
  label?: string;
  hint?: string;
  count?: number;
};

type BroadcastConsoleProps = {
  initialEmployees: Employee[];
  templateName: string;
};

type TargetMode = "mixed" | "group" | "custom";
type ToastKind = "success" | "error" | "info";
type GroupAudience = Exclude<BroadcastAudienceCategory, "custom">;
type PreviewAudienceScope = "preview" | GroupAudience;

type ToastItem = {
  id: number;
  kind: ToastKind;
  title: string;
  message: string;
};

type DeliveryRecipient = {
  employeeId: string;
  fullName: string;
  status: string;
  failureReason: string | null;
  channel: string | null;
};

type DeliveryInfo = {
  total: number;
  undelivered: number;
  counts: Record<string, number>;
  recipients: DeliveryRecipient[];
};

const targetModeOptions: Array<{ value: TargetMode; label: string }> = [
  { value: "mixed", label: "Mixed (AI)" },
  { value: "group", label: "Group" },
  { value: "custom", label: "Custom" },
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

const previewAudienceOptions: Array<{ value: PreviewAudienceScope; label: string }> = [
  { value: "preview", label: "Current Preview" },
  { value: "all", label: "All" },
  { value: "sales_team", label: "Sales" },
  { value: "head_office", label: "Head Office" },
  { value: "drivers", label: "Drivers" },
  { value: "customers", label: "Customers" },
];

const PREVIEW_REQUEST_TIMEOUT_MS = 35000;
const PREVIEW_MAX_RETRIES = 2;

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

function userFriendlyAiWarning(warning: string): string {
  const value = warning.toLowerCase();
  if (value.includes("429") || value.includes("quota")) {
    return "AI quota is temporarily exceeded, so fallback drafting was used.";
  }
  if (
    value.includes("timed out") ||
    value.includes("timeout") ||
    value.includes("network") ||
    value.includes("connectivity is unstable")
  ) {
    return "AI connectivity is unstable right now, so fallback drafting was used.";
  }
  return warning.replace(/^.*fallback:\s*/i, "").trim() || "AI fallback was used.";
}

function ownerLabel(owner: BroadcastFailureSummary["owner"]): string {
  if (owner === "meta_compliance") return "Meta compliance/policy";
  if (owner === "meta_template") return "Meta template setup";
  if (owner === "recipient_data") return "Recipient data";
  if (owner === "environment") return "Environment/config";
  return "Unknown";
}

function audienceScopeLabel(value: PreviewAudienceScope): string {
  if (value === "preview") return "Current Preview";
  if (value === "all") return "All";
  if (value === "sales_team") return "Sales";
  if (value === "head_office") return "Head Office";
  if (value === "drivers") return "Drivers";
  return "Customers";
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
  const [previewBaseAudienceCategory, setPreviewBaseAudienceCategory] = useState<BroadcastAudienceCategory>("all");
  const [previewAudienceCategory, setPreviewAudienceCategory] = useState<BroadcastAudienceCategory>("all");
  const [previewAudienceScope, setPreviewAudienceScope] = useState<PreviewAudienceScope>("preview");
  const [previewRecipientSearch, setPreviewRecipientSearch] = useState("");
  const [previewSelectedRecipientIds, setPreviewSelectedRecipientIds] = useState<string[]>([]);
  const [reviewedMessage, setReviewedMessage] = useState("");
  const [previewGeneratedAt, setPreviewGeneratedAt] = useState("");
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [regenerateInstruction, setRegenerateInstruction] = useState("");

  const [status, setStatus] = useState("Ready.");
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toastCounterRef = useRef(0);

  const [isRecording, setIsRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioInputRef = useRef<HTMLInputElement | null>(null);

  // Transcribe a recorded/uploaded voice note via Whisper and append the text to
  // the instruction box, where it flows through the same GPT-4.1 draft pipeline.
  const transcribeAudio = async (blob: Blob, filename: string) => {
    setTranscribing(true);
    setStatus("Transcribing voice note...");
    try {
      const form = new FormData();
      form.append("audio", blob, filename);
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok) throw new Error(data.error || "Transcription failed");
      const text = (data.text ?? "").trim();
      if (!text) {
        setStatus("No speech detected in the voice note.");
        pushToast("info", "No speech detected", "The voice note had no recognizable speech.");
        return;
      }
      pushToast("success", "Voice captured", "Drafting your message from the voice note...");
      // The transcript is consumed directly by the AI — we never surface it in the
      // composer; the user only sees the drafted result in the preview.
      void requestPreview({
        messageOverride: text,
        loadingStatus: "Drafting your message from the voice note...",
      });
    } catch (error) {
      const msg = (error as Error).message || "Transcription failed";
      setStatus(msg);
      pushToast("error", "Transcription failed", msg);
    } finally {
      setTranscribing(false);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const type = recorder.mimeType || "audio/webm";
        const blob = new Blob(audioChunksRef.current, { type });
        const ext = type.includes("ogg") ? "ogg" : type.includes("mp4") ? "mp4" : "webm";
        void transcribeAudio(blob, `voice-note.${ext}`);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setStatus("Recording... tap Stop when finished.");
    } catch {
      pushToast("error", "Microphone blocked", "Allow microphone access to record a voice note.");
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setIsRecording(false);
  };

  const onPickAudioFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void transcribeAudio(file, file.name);
  };

  const [lastCampaignId, setLastCampaignId] = useState<string>("");
  const [deliveryInfo, setDeliveryInfo] = useState<DeliveryInfo | null>(null);
  const [checkingDelivery, setCheckingDelivery] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const checkDelivery = async (campaignId: string) => {
    if (!campaignId) return;
    setCheckingDelivery(true);
    try {
      const res = await fetch(`/api/broadcasts/deliveries?campaignId=${encodeURIComponent(campaignId)}`);
      const data = (await res.json().catch(() => ({}))) as DeliveryInfo & { error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to load delivery status");
      setDeliveryInfo(data);
    } catch (error) {
      pushToast("error", "Delivery status failed", (error as Error).message);
    } finally {
      setCheckingDelivery(false);
    }
  };

  const resendUndelivered = async () => {
    if (!lastCampaignId) return;
    setRetrying(true);
    try {
      const res = await fetch("/api/broadcasts/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId: lastCampaignId }),
      });
      const data = (await res.json().catch(() => ({}))) as { retried?: number; accepted?: number; failed?: number; error?: string };
      if (!res.ok) throw new Error(data.error || "Retry failed");
      if (Number(data.retried ?? 0) === 0) {
        pushToast("info", "Nothing to resend", "All recipients are already delivered.");
      } else {
        pushToast("success", "Resent to undelivered", `Re-sent ${data.retried}: accepted ${data.accepted}, failed ${data.failed}.`);
      }
      await checkDelivery(lastCampaignId);
    } catch (error) {
      pushToast("error", "Resend failed", (error as Error).message);
    } finally {
      setRetrying(false);
    }
  };

  const busy = previewing || sending;
  const employeesById = useMemo(
    () => new Map(initialEmployees.map((employee) => [employee.id, employee])),
    [initialEmployees],
  );

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

  const previewRecipientBaseIds = useMemo(
    () => (preview ? dedupe(preview.recipients.map((recipient) => recipient.id)) : []),
    [preview],
  );
  const previewSelectedSet = useMemo(
    () => new Set(previewSelectedRecipientIds),
    [previewSelectedRecipientIds],
  );
  const previewScopedCandidateIds = useMemo(() => {
    if (!preview) return [];
    if (previewAudienceScope === "preview") return previewRecipientBaseIds;
    return dedupe(
      initialEmployees
        .filter((employee) => employee.is_active && isEmployeeInAudience(employee, previewAudienceScope))
        .map((employee) => employee.id),
    );
  }, [initialEmployees, preview, previewAudienceScope, previewRecipientBaseIds]);
  const previewScopedCandidates = useMemo(
    () => previewScopedCandidateIds
      .map((id) => employeesById.get(id))
      .filter((employee): employee is Employee => Boolean(employee)),
    [employeesById, previewScopedCandidateIds],
  );
  const filteredPreviewScopedCandidates = useMemo(
    () => previewScopedCandidates.filter((employee) => employeeMatchesQuery(employee, previewRecipientSearch)),
    [previewRecipientSearch, previewScopedCandidates],
  );
  const previewRecipientCount = previewSelectedRecipientIds.length;
  const previewScopedSelectedCount = previewScopedCandidateIds.filter((id) => previewSelectedSet.has(id)).length;

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

  function applyPreviewAudienceScope(nextScope: PreviewAudienceScope): void {
    setPreviewAudienceScope(nextScope);
    setPreviewRecipientSearch("");

    if (!preview) return;

    if (nextScope === "preview") {
      setPreviewAudienceCategory(previewBaseAudienceCategory);
      setPreviewSelectedRecipientIds(previewRecipientBaseIds);
      return;
    }

    const nextRecipientIds = dedupe(
      initialEmployees
        .filter((employee) => employee.is_active && isEmployeeInAudience(employee, nextScope))
        .map((employee) => employee.id),
    );
    setPreviewAudienceCategory(nextScope);
    setPreviewSelectedRecipientIds(nextRecipientIds);
  }

  function togglePreviewRecipient(id: string, checked: boolean): void {
    setPreviewSelectedRecipientIds((prev) => {
      if (checked) {
        return dedupe([...prev, id]);
      }
      return prev.filter((item) => item !== id);
    });
  }

  function selectAllScopedPreviewRecipients(): void {
    setPreviewSelectedRecipientIds((prev) => dedupe([...prev, ...previewScopedCandidateIds]));
  }

  function selectFilteredScopedPreviewRecipients(): void {
    setPreviewSelectedRecipientIds((prev) => dedupe([
      ...prev,
      ...filteredPreviewScopedCandidates.map((employee) => employee.id),
    ]));
  }

  function clearFilteredScopedPreviewRecipients(): void {
    const idsToRemove = new Set(filteredPreviewScopedCandidates.map((employee) => employee.id));
    setPreviewSelectedRecipientIds((prev) => prev.filter((id) => !idsToRemove.has(id)));
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

  function buildReviewedRoutesForSend(
    previewPayload: PreviewResponse,
    finalMessage: string,
    selectedRecipientIds: string[],
  ) {
    const selectedSet = new Set(selectedRecipientIds);
    const covered = new Set<string>();

    const reviewedRoutes = previewPayload.routes
      .map((route) => {
        const filteredRecipientIds = route.recipientEmployeeIds.filter((id) => selectedSet.has(id));
        for (const id of filteredRecipientIds) covered.add(id);
        return {
        routeId: route.routeId,
        targetLabel: route.targetLabel,
        source: route.source,
        recipientEmployeeIds: filteredRecipientIds,
        message:
          route.source === "ai_person" || route.source === "ai_group"
            ? (route.instruction.trim() || finalMessage)
            : finalMessage,
        };
      })
      .filter((route) => route.recipientEmployeeIds.length > 0);

    const fallbackIds = selectedRecipientIds.filter((id) => !covered.has(id));
    if (fallbackIds.length > 0) {
      reviewedRoutes.push({
        routeId: `manual-fallback-${Date.now()}`,
        targetLabel: "Audience override",
        source: "manual",
        recipientEmployeeIds: fallbackIds,
        message: finalMessage,
      });
    }

    return reviewedRoutes;
  }

  function applySendResponse(json: Record<string, unknown>) {
    const campaignId = String((json as { campaignId?: string }).campaignId ?? "");
    if (campaignId) {
      setLastCampaignId(campaignId);
      setDeliveryInfo(null);
    }
    const accepted = Number(
      (json as { accepted?: number; sent?: number }).accepted ??
        (json as { sent?: number }).sent ??
        0,
    );
    const failed = Number((json as { failed?: number }).failed ?? 0);
    const failureDetails = ((json as { failureDetails?: BroadcastSendFailure[] }).failureDetails ?? []).filter(
      (item) => item.reason,
    );
    const failureSummary = ((json as { failureSummary?: BroadcastFailureSummary[] }).failureSummary ?? [])
      .filter((row) => Number(row.count ?? 0) > 0)
      .sort((a, b) => Number(b.count ?? 0) - Number(a.count ?? 0));
    const topFailure = failureSummary[0];
    const failurePreview = failureDetails[0];

    if (failed > 0) {
      const partialMessage = failurePreview
        ? `Campaign ${(json as { campaignId: string }).campaignId}: accepted=${accepted}, failed=${failed}. First error for ${failurePreview.employeeName || "recipient"}: ${failurePreview.reason}${failurePreview.languageCode ? ` (lang: ${failurePreview.languageCode})` : ""}${failurePreview.templateVariant ? ` (variant: ${failurePreview.templateVariant})` : ""}`
        : `Campaign ${(json as { campaignId: string }).campaignId}: accepted=${accepted}, failed=${failed}.`;
      setStatus(partialMessage);
      if (topFailure) {
        const topCount = Number(topFailure.count ?? 0);
        const headline = accepted > 0 ? "Broadcast sent with partial failures" : "Broadcast failed";
        const detail = `${ownerLabel(topFailure.owner)}: ${topFailure.label || "delivery issue"} (${topCount}/${failed}). ${topFailure.hint || ""}`.trim();
        pushToast("info", headline, detail);
      } else {
        pushToast("info", "Broadcast sent with failures", `Accepted: ${accepted}, Failed: ${failed}`);
      }
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
          await delay(500 * (attempt + 1));
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
      const nextReviewedMessage = deriveEditorMessageFromPreview(parsed, trimmedMessage, targetMode);
      const requestedRegeneration = Boolean(options?.aiRegenerateInstruction?.trim());
      const previousDraftText = (options?.previousDraft ?? "").trim();
      const regenerateUnchanged = requestedRegeneration &&
        previousDraftText &&
        collapseWhitespace(previousDraftText) === collapseWhitespace(nextReviewedMessage);
      setPreview(parsed);
      setPreviewBaseAudienceCategory(payload.audienceCategory);
      setPreviewAudienceCategory(payload.audienceCategory);
      setPreviewAudienceScope("preview");
      setPreviewRecipientSearch("");
      setPreviewSelectedRecipientIds(dedupe(parsed.recipients.map((recipient) => recipient.id)));
      setReviewedMessage(nextReviewedMessage);
      setPreviewGeneratedAt(new Date().toLocaleString());
      setPreviewModalOpen(true);
      setRegenerateInstruction("");

      const warnings = previewWarnings(parsed);
      if (warnings.length > 0) {
        const friendlyWarning = userFriendlyAiWarning(warnings[0]);
        setStatus(`Preview ready with fallback: ${friendlyWarning}`);
        if (requestedRegeneration && regenerateUnchanged) {
          pushToast("info", "Regeneration fallback used", `${friendlyWarning} Draft remained unchanged.`);
        } else {
          pushToast("info", "Preview ready with fallback", friendlyWarning);
        }
      } else {
        const modeText = draftModeLabel(parsed);
        if (requestedRegeneration && regenerateUnchanged) {
          setStatus(`Regeneration completed, but draft stayed the same.`);
          pushToast("info", "Regeneration unchanged", "AI kept the previous draft based on your instruction.");
        } else {
          setStatus(`${modeText}: ${parsed.recipients.length} recipient(s), ${parsed.routes.length} route(s).`);
          pushToast("success", "Preview ready", `${modeText} for ${parsed.recipients.length} recipients.`);
        }
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

    if (previewSelectedRecipientIds.length === 0) {
      setStatus("No recipients selected.");
      pushToast("error", "No recipients", "Select at least one recipient in preview before sending.");
      return;
    }

    const reviewedRoutes = buildReviewedRoutesForSend(preview, finalMessage, previewSelectedRecipientIds);

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
          // Fall back to the final message when the raw input box is empty
          // (e.g. drafted via voice / AI / pasted straight into the review box),
          // so the server's non-empty originalMessage check doesn't reject it.
          originalMessage: message.trim() || finalMessage,
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
      const reviewedRoutes = buildReviewedRoutesForSend(
        parsed,
        trimmedMessage,
        parsed.recipients.map((recipient) => recipient.id),
      );

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
            <div className="inline" style={{ gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  if (isRecording) stopRecording();
                  else void startRecording();
                }}
                disabled={transcribing}
              >
                {isRecording ? "⏹ Stop recording" : "🎙 Record voice note"}
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => audioInputRef.current?.click()}
                disabled={isRecording || transcribing}
              >
                {transcribing ? "Transcribing..." : "Upload audio"}
              </button>
              <input
                ref={audioInputRef}
                type="file"
                accept="audio/*"
                style={{ display: "none" }}
                onChange={onPickAudioFile}
              />
            </div>
          </label>

          <article className="panel grid broadcast-audience" style={{ gap: 10 }}>
            <div className="broadcast-audience-head">
              <span className="muted" style={{ fontWeight: 700 }}>2. Choose Audience</span>
              <span className="muted" style={{ fontSize: 12 }}>
                Pick who receives this, then use the buttons below to preview or send.
              </span>
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

          <div className="broadcast-actions">
            <button
              type="button"
              className="ghost"
              onClick={() => void onSendWithoutPreview()}
              disabled={busy || targetMode === "mixed"}
              title={targetMode === "mixed" ? "Mixed mode requires AI preview" : "Send directly without opening preview"}
            >
              {sending ? "Sending..." : "Send Without AI Preview"}
            </button>
            <button type="submit" className="broadcast-cta" disabled={busy}>
              {previewing ? "Generating..." : "Generate AI Preview"}
            </button>
          </div>
        </form>

        {lastCampaignId ? (
          <article className="panel grid" style={{ gap: 10 }}>
            <div className="inline" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <span className="muted" style={{ fontWeight: 700 }}>Delivery status (last broadcast)</span>
              <div className="inline" style={{ gap: 8 }}>
                <button type="button" className="ghost" onClick={() => void checkDelivery(lastCampaignId)} disabled={checkingDelivery || retrying}>
                  {checkingDelivery ? "Checking..." : "Check delivery"}
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void resendUndelivered()}
                  disabled={retrying || checkingDelivery || (deliveryInfo !== null && deliveryInfo.undelivered === 0)}
                  title="Re-send to recipients not yet delivered (free-form if in 24h window, else template)"
                >
                  {retrying ? "Resending..." : "Resend to undelivered"}
                </button>
              </div>
            </div>
            {deliveryInfo ? (
              <div className="grid" style={{ gap: 6 }}>
                <span className="muted">
                  {deliveryInfo.total} recipient(s) · delivered {(deliveryInfo.counts.delivered ?? 0) + (deliveryInfo.counts.read ?? 0)} · accepted {deliveryInfo.counts.accepted ?? 0} · failed {deliveryInfo.counts.failed ?? 0} · undelivered {deliveryInfo.undelivered}
                </span>
                {deliveryInfo.recipients
                  .filter((row) => row.status === "accepted" || row.status === "failed")
                  .slice(0, 25)
                  .map((row) => (
                    <span key={row.employeeId} className="muted" style={{ fontSize: 12 }}>
                      • {row.fullName} — {row.status}{row.failureReason ? `: ${row.failureReason}` : ""}
                    </span>
                  ))}
              </div>
            ) : (
              <span className="muted">Check delivery to see who received it; resend to recover any that didn&apos;t.</span>
            )}
          </article>
        ) : null}
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

            <label className="grid" style={{ gap: 6 }}>
              <span>Message</span>
              <textarea
                value={reviewedMessage}
                onChange={(event) => setReviewedMessage(event.target.value)}
                style={{ minHeight: 180 }}
              />
            </label>

            <div className="panel grid" style={{ gap: 10 }}>
              <div className="inline" style={{ justifyContent: "space-between" }}>
                <strong>Selected Recipients</strong>
                <span className="muted">
                  Selected: {previewRecipientCount} | Scope: {audienceScopeLabel(previewAudienceScope)} ({previewScopedSelectedCount}/{previewScopedCandidateIds.length})
                </span>
              </div>

              <div className="inline" style={{ flexWrap: "wrap", gap: 8 }}>
                {previewAudienceOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={previewAudienceScope === option.value ? "" : "ghost"}
                    onClick={() => applyPreviewAudienceScope(option.value)}
                    disabled={busy}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <span className="muted">Adjust who receives this send.</span>

              <input
                className="input"
                value={previewRecipientSearch}
                onChange={(event) => setPreviewRecipientSearch(event.target.value)}
                placeholder="Search recipients by name, number, department, designation"
                disabled={busy}
              />

              <div className="inline" style={{ flexWrap: "wrap", gap: 8 }}>
                <button type="button" className="ghost" onClick={() => selectFilteredScopedPreviewRecipients()} disabled={busy}>
                  Select Filtered
                </button>
                <button type="button" className="ghost" onClick={() => selectAllScopedPreviewRecipients()} disabled={busy}>
                  Select Scope
                </button>
                <button type="button" className="ghost" onClick={() => clearFilteredScopedPreviewRecipients()} disabled={busy}>
                  Unselect Filtered
                </button>
                <button type="button" className="ghost" onClick={() => applyPreviewAudienceScope("preview")} disabled={busy}>
                  Reset to Preview
                </button>
                <span className="muted">Showing: {filteredPreviewScopedCandidates.length}</span>
              </div>

              <div className="table-wrap" style={{ maxHeight: 220, overflowY: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 64 }}>Pick</th>
                      <th style={{ minWidth: 220 }}>Name</th>
                      <th style={{ minWidth: 160 }}>Department</th>
                      <th style={{ minWidth: 170 }}>Designation</th>
                      <th style={{ minWidth: 170 }}>WhatsApp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPreviewScopedCandidates.map((employee) => (
                      <tr key={employee.id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={previewSelectedSet.has(employee.id)}
                            onChange={(event) => togglePreviewRecipient(employee.id, event.target.checked)}
                            disabled={busy}
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

            {preview.unresolvedMentions.length ? (
              <p className="muted">Unresolved mentions: {preview.unresolvedMentions.join(", ")}</p>
            ) : null}
            {preview.unresolvedAiTargets.length ? (
              <p className="muted">Couldn&apos;t match: {preview.unresolvedAiTargets.join(", ")}</p>
            ) : null}

            <div className="inline broadcast-modal-actions" style={{ justifyContent: "space-between" }}>
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
