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

const groupAudienceOptions: Array<{ value: Exclude<BroadcastAudienceCategory, "custom">; label: string }> = [
  { value: "all", label: "All" },
  { value: "sales_team", label: "Sales" },
  { value: "head_office", label: "Head Office" },
  { value: "drivers", label: "Drivers" },
  { value: "customers", label: "Customers" },
];

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
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
    warnings.push(`Rewrite AI fallback: ${rewrite.error || "AI rewrite unavailable"}`);
  }

  return warnings;
}

export function BroadcastConsole({ initialEmployees, templateName }: BroadcastConsoleProps) {
  const [message, setMessage] = useState("");
  const [targetMode, setTargetMode] = useState<TargetMode>("mixed");
  const [groupAudience, setGroupAudience] = useState<Exclude<BroadcastAudienceCategory, "custom">>("all");
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");

  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewAudienceCategory, setPreviewAudienceCategory] = useState<BroadcastAudienceCategory>("all");
  const [reviewedMessage, setReviewedMessage] = useState("");
  const [previewGeneratedAt, setPreviewGeneratedAt] = useState("");
  const [previewModalOpen, setPreviewModalOpen] = useState(false);

  const [status, setStatus] = useState("Ready.");
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toastCounterRef = useRef(0);

  const busy = previewing || sending;

  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return initialEmployees;
    return initialEmployees.filter((employee) => {
      return (
        employee.full_name.toLowerCase().includes(q) ||
        employee.whatsapp_e164.toLowerCase().includes(q) ||
        String(employee.department || "").toLowerCase().includes(q) ||
        String(employee.designation || "").toLowerCase().includes(q)
      );
    });
  }, [initialEmployees, search]);

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

  function buildPreviewPayload() {
    if (targetMode === "custom") {
      return {
        audienceCategory: "custom" as BroadcastAudienceCategory,
        selectedEmployeeIds,
        useAiRouting: false,
      };
    }

    if (targetMode === "group") {
      return {
        audienceCategory: groupAudience as BroadcastAudienceCategory,
        selectedEmployeeIds: [] as string[],
        useAiRouting: false,
      };
    }

    return {
      audienceCategory: "custom" as BroadcastAudienceCategory,
      selectedEmployeeIds: [] as string[],
      useAiRouting: true,
    };
  }

  async function onPreview(event: FormEvent) {
    event.preventDefault();

    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      setStatus("Write a message before generating preview.");
      pushToast("error", "Message required", "Please write the CEO message first.");
      return;
    }

    if (targetMode === "custom" && selectedEmployeeIds.length === 0) {
      setStatus("Pick at least one member for custom broadcast.");
      pushToast("error", "No recipients", "Select at least one member for custom broadcast.");
      return;
    }

    setPreviewing(true);
    setStatus("Generating AI preview...");

    const payload = buildPreviewPayload();

    try {
      const res = await fetch("/api/broadcasts/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmedMessage,
          audienceCategory: payload.audienceCategory,
          selectedEmployeeIds: payload.selectedEmployeeIds,
          selectedTagKeys: [],
          useAiRouting: payload.useAiRouting,
        }),
      });

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
      setReviewedMessage((parsed.enhancedMessage || trimmedMessage).trim());
      setPreviewGeneratedAt(new Date().toLocaleString());
      setPreviewModalOpen(true);
      const warnings = previewWarnings(parsed);
      if (warnings.length > 0) {
        setStatus(`Preview ready with AI fallback: ${warnings[0]}`);
        pushToast("info", "Preview ready with fallback", warnings[0]);
      } else {
        setStatus(`Preview ready: ${parsed.recipients.length} recipient(s), ${parsed.routes.length} route(s).`);
        pushToast("success", "Preview ready", `AI preview generated for ${parsed.recipients.length} recipients.`);
      }
    } catch {
      setStatus("Preview request failed. Please retry.");
      pushToast("error", "Network error", "Preview request failed. Please retry.");
    } finally {
      setPreviewing(false);
    }
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

    const reviewedRoutes = preview.routes
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
      } else {
        const successMessage = `Campaign ${(json as { campaignId: string }).campaignId}: accepted=${accepted}, failed=${failed}.`;
        setStatus(successMessage);
        pushToast("success", "Broadcast sent", `Successfully queued ${accepted} messages.`);
        setPreviewModalOpen(false);
      }
    } catch {
      setStatus("Broadcast request failed. Please retry.");
      pushToast("error", "Network error", "Broadcast request failed. Please retry.");
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
            <span className="muted" style={{ fontWeight: 700 }}>1. Draft Message</span>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Write the CEO broadcast message..."
              style={{ minHeight: 130 }}
              required
            />
          </label>

          <article className="panel grid broadcast-audience" style={{ gap: 10 }}>
            <div className="inline broadcast-audience-head" style={{ justifyContent: "space-between" }}>
              <span className="muted" style={{ fontWeight: 700 }}>2. Choose Audience</span>
              <button type="submit" disabled={busy}>
                {previewing ? "Generating..." : "Generate AI Preview"}
              </button>
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
                <span>Group Category</span>
                <div className="inline">
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
                <span className="muted">
                  Group selection builds a direct preview for this category.
                </span>
              </div>
            ) : (
              <div className="grid broadcast-mixed-mode" style={{ gap: 8 }}>
                <span className="muted">
                  AI-only targeting is active. Recipients will come from names/groups identified in the message.
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
            </div>

            <label className="grid" style={{ gap: 6 }}>
              <span>Final Message (Editable)</span>
              <textarea
                value={reviewedMessage}
                onChange={(event) => setReviewedMessage(event.target.value)}
                style={{ minHeight: 180 }}
              />
            </label>

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
