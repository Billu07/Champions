"use client";

import { FormEvent, useMemo, useRef, useState } from "react";
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

  const [status, setStatus] = useState("Ready.");
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);

  const reviewRef = useRef<HTMLElement | null>(null);

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
      audienceCategory: groupAudience as BroadcastAudienceCategory,
      selectedEmployeeIds: [] as string[],
      useAiRouting: true,
    };
  }

  async function onPreview(event: FormEvent) {
    event.preventDefault();

    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      setStatus("Write a message before generating preview.");
      return;
    }

    if (targetMode === "custom" && selectedEmployeeIds.length === 0) {
      setStatus("Pick at least one member for custom broadcast.");
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
        setStatus((json as { error?: string }).error ?? "Preview failed.");
        return;
      }

      const parsed = json as PreviewResponse;
      setPreview(parsed);
      setPreviewAudienceCategory(payload.audienceCategory);
      setReviewedMessage((parsed.enhancedMessage || trimmedMessage).trim());
      setPreviewGeneratedAt(new Date().toLocaleString());
      setStatus(`Preview ready: ${parsed.recipients.length} recipient(s), ${parsed.routes.length} route(s).`);

      setTimeout(() => {
        reviewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 80);
    } catch {
      setStatus("Preview request failed. Please retry.");
    } finally {
      setPreviewing(false);
    }
  }

  async function onSend() {
    if (!preview) {
      setStatus("Generate preview first.");
      return;
    }

    const finalMessage = reviewedMessage.trim() || message.trim();
    if (!finalMessage) {
      setStatus("Final message is empty.");
      return;
    }

    const reviewedRoutes = preview.routes
      .filter((route) => route.recipientEmployeeIds.length > 0)
      .map((route) => ({
        routeId: route.routeId,
        targetLabel: route.targetLabel,
        source: route.source,
        recipientEmployeeIds: route.recipientEmployeeIds,
        message: finalMessage,
      }));

    if (reviewedRoutes.length === 0) {
      setStatus("No valid recipients in preview routes.");
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
        setStatus((json as { error?: string }).error ?? "Broadcast failed.");
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
        setStatus(
          `Campaign ${(json as { campaignId: string }).campaignId}: accepted=${accepted}, failed=${failed}. First error for ${failurePreview.employeeName || "recipient"}: ${failurePreview.reason}${failurePreview.languageCode ? ` (lang: ${failurePreview.languageCode})` : ""}${failurePreview.templateVariant ? ` (variant: ${failurePreview.templateVariant})` : ""}`,
        );
      } else {
        setStatus(`Campaign ${(json as { campaignId: string }).campaignId}: accepted=${accepted}, failed=${failed}.`);
      }
    } catch {
      setStatus("Broadcast request failed. Please retry.");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="grid" style={{ gap: 14 }}>
      <article className="panel status-banner">
        <div className="inline" style={{ justifyContent: "space-between", width: "100%" }}>
          <div className="inline">
            {busy ? <span className="status-spinner" aria-hidden="true" /> : null}
            <strong>{sending ? "Sending..." : previewing ? "Generating Preview..." : "Broadcast Status"}</strong>
          </div>
          <span className="muted">{status}</span>
        </div>
      </article>

      <article className="card grid" style={{ gap: 14 }}>
        <div className="inline" style={{ justifyContent: "space-between" }}>
          <h2>CEO Broadcast Station</h2>
          <span className="pill">Template: {templateName}</span>
        </div>

        <form className="grid" onSubmit={onPreview} style={{ gap: 14 }}>
          <label className="grid" style={{ gap: 6 }}>
            <span className="muted" style={{ fontWeight: 700 }}>1. Draft Message</span>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Write the CEO broadcast message..."
              style={{ minHeight: 130 }}
              required
            />
          </label>

          <article className="panel grid" style={{ gap: 10 }}>
            <span className="muted" style={{ fontWeight: 700 }}>2. Choose Audience</span>
            <div className="inline">
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
              <div className="grid" style={{ gap: 8 }}>
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

                <div className="table-wrap" style={{ maxHeight: 340, overflowY: "auto" }}>
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
            ) : (
              <div className="grid" style={{ gap: 8 }}>
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
                  {targetMode === "mixed"
                    ? "AI will generate routing preview. You can edit the final message before send."
                    : "A clean group broadcast preview will be generated for this category."}
                </span>
              </div>
            )}
          </article>

          <div className="inline" style={{ justifyContent: "space-between" }}>
            <span className="muted">3. Generate preview, confirm or edit, then send.</span>
            <button type="submit" disabled={busy}>
              {previewing ? "Generating..." : "Generate AI Preview"}
            </button>
          </div>
        </form>
      </article>

      {preview ? (
        <article className="card grid" style={{ gap: 12 }} ref={reviewRef}>
          <div className="inline" style={{ justifyContent: "space-between" }}>
            <h2>AI Preview</h2>
            <span className="muted">
              Recipients: {previewRecipientCount} | Routes: {previewRouteCount}
              {previewGeneratedAt ? ` | ${previewGeneratedAt}` : ""}
            </span>
          </div>

          <label className="grid" style={{ gap: 6 }}>
            <span>Final Message (Editable)</span>
            <textarea
              value={reviewedMessage}
              onChange={(event) => setReviewedMessage(event.target.value)}
              style={{ minHeight: 170 }}
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
                </tr>
              </thead>
              <tbody>
                {preview.routes.map((route) => (
                  <tr key={route.routeId}>
                    <td>{route.targetLabel}</td>
                    <td>{route.source}</td>
                    <td>{route.recipientEmployeeIds.length}</td>
                    <td>{Math.round(route.confidence * 100)}%</td>
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

          <div className="inline" style={{ justifyContent: "space-between" }}>
            <span className="muted">Confirm this message and send broadcast.</span>
            <button type="button" onClick={() => void onSend()} disabled={busy}>
              {sending ? "Sending..." : "Send Broadcast"}
            </button>
          </div>
        </article>
      ) : null}
    </section>
  );
}
