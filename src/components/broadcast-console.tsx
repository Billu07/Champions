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
  tags?: Array<{ key: string; label: string }>;
};

type Tag = {
  key: string;
  label: string;
};

type PreviewResponse = {
  recipients: Employee[];
  routes: BroadcastPreviewRoute[];
  mentionMatches: Array<{ employeeId: string; fullName: string; confidence: number; reason: string }>;
  unresolvedMentions: string[];
  unresolvedAiTargets: string[];
  enhancedMessage: string;
};

type BroadcastConsoleProps = {
  initialEmployees: Employee[];
  initialTags: Tag[];
  templateName: string;
};

const audienceOptions: Array<{ value: BroadcastAudienceCategory; label: string }> = [
  { value: "sales_team", label: "Sales Team" },
  { value: "head_office", label: "Head Office" },
  { value: "drivers", label: "Drivers" },
  { value: "customers", label: "Customers" },
  { value: "all", label: "All Members" },
  { value: "custom", label: "Custom" },
];

function tagLabelFromCategory(category: BroadcastAudienceCategory): string {
  if (category === "sales_team") return "sales_field";
  if (category === "head_office") return "head_office";
  if (category === "drivers") return "drivers";
  if (category === "customers") return "customers";
  return "";
}

function parseMultiSelectValues(select: HTMLSelectElement): string[] {
  return Array.from(select.selectedOptions).map((option) => option.value);
}

export function BroadcastConsole({ initialEmployees, initialTags, templateName }: BroadcastConsoleProps) {
  const [employees] = useState<Employee[]>(initialEmployees);
  const [tags] = useState<Tag[]>(initialTags);
  const [message, setMessage] = useState("");
  const [audienceCategory, setAudienceCategory] = useState<BroadcastAudienceCategory>("custom");
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const [selectedTagKeys, setSelectedTagKeys] = useState<string[]>([]);
  const [useAiRouting, setUseAiRouting] = useState(true);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [routeMessageDrafts, setRouteMessageDrafts] = useState<Record<string, string>>({});
  const [enabledRouteIds, setEnabledRouteIds] = useState<string[]>([]);
  const [enhancedMessageDraft, setEnhancedMessageDraft] = useState("");
  const [useEnhancedForFallback, setUseEnhancedForFallback] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("");
  const [sending, setSending] = useState(false);
  const [previewGeneratedAt, setPreviewGeneratedAt] = useState<string>("");
  const reviewRef = useRef<HTMLElement | null>(null);

  const employeesById = useMemo(() => new Map(employees.map((employee) => [employee.id, employee])), [employees]);

  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((employee) => {
      return (
        employee.full_name.toLowerCase().includes(q) ||
        employee.whatsapp_e164.toLowerCase().includes(q) ||
        String(employee.department || "").toLowerCase().includes(q) ||
        String(employee.designation || "").toLowerCase().includes(q)
      );
    });
  }, [employees, search]);

  const routeRecipientCount = useMemo(() => {
    if (!preview) return 0;
    const ids = new Set<string>();
    for (const route of preview.routes) {
      if (!enabledRouteIds.includes(route.routeId)) continue;
      for (const id of route.recipientEmployeeIds) ids.add(id);
    }
    return ids.size;
  }, [preview, enabledRouteIds]);

  function toggleEmployee(id: string, checked: boolean): void {
    setSelectedEmployeeIds((prev) =>
      checked ? Array.from(new Set([...prev, id])) : prev.filter((item) => item !== id),
    );
  }

  async function onPreview(event: FormEvent) {
    event.preventDefault();
    setStatus("Generating broadcast preview...");

    const categoryTag = tagLabelFromCategory(audienceCategory);
    const effectiveTags = categoryTag && !selectedTagKeys.includes(categoryTag)
      ? Array.from(new Set([...selectedTagKeys, categoryTag]))
      : selectedTagKeys;

    const res = await fetch("/api/broadcasts/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        audienceCategory,
        selectedEmployeeIds,
        selectedTagKeys: effectiveTags,
        useAiRouting,
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus((json as { error?: string }).error ?? "Preview failed");
      return;
    }

    const parsed = json as PreviewResponse;
    setPreview(parsed);
    setPreviewGeneratedAt(new Date().toLocaleString());
    setEnhancedMessageDraft(parsed.enhancedMessage);
    setRouteMessageDrafts(Object.fromEntries(parsed.routes.map((route) => [route.routeId, route.instruction])));
    setEnabledRouteIds(parsed.routes.map((route) => route.routeId));
    setStatus(`Preview ready: ${parsed.routes.length} route(s), ${parsed.recipients.length} recipient(s).`);

    setTimeout(() => {
      reviewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }

  async function onSend() {
    if (!preview) return;
    setSending(true);

    try {
      const reviewedRoutes = preview.routes
        .filter((route) => enabledRouteIds.includes(route.routeId))
        .map((route) => {
          const draft = (routeMessageDrafts[route.routeId] ?? route.instruction).trim();
          const fallbackEnhance = route.source === "manual" || route.source === "tag" || route.source === "mixed";

          return {
            routeId: route.routeId,
            targetLabel: route.targetLabel,
            source: route.source,
            recipientEmployeeIds: route.recipientEmployeeIds,
            message: draft || (useEnhancedForFallback && fallbackEnhance ? enhancedMessageDraft : message),
          };
        })
        .filter((route) => route.recipientEmployeeIds.length > 0 && route.message.length > 0);

      if (reviewedRoutes.length === 0) {
        setStatus("No valid route selected for sending.");
        return;
      }

      setStatus("Sending broadcast...");

      const res = await fetch("/api/broadcasts/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalMessage: message,
          finalMessage: useEnhancedForFallback ? enhancedMessageDraft : message,
          audienceCategory,
          reviewedRoutes,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus((json as { error?: string }).error ?? "Broadcast failed");
        return;
      }

      const accepted = Number((json as { accepted?: number; sent?: number }).accepted ?? (json as { sent?: number }).sent ?? 0);
      const failed = Number((json as { failed?: number }).failed ?? 0);
      setStatus(
        `Campaign ${(json as { campaignId: string }).campaignId}: accepted=${accepted}, failed=${failed}.`,
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="grid" style={{ gap: 14 }}>
      <article className="card grid" style={{ gap: 12 }}>
        <div className="inline" style={{ justifyContent: "space-between" }}>
          <h2>CEO Broadcast Zone</h2>
          <span className="pill">Template: {templateName}</span>
        </div>

        <form className="grid" onSubmit={onPreview} style={{ gap: 12 }}>
          <div className="grid" style={{ gap: 8 }}>
            <span className="muted" style={{ fontWeight: 600 }}>Audience</span>
            <div className="inline">
              {audienceOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={audienceCategory === option.value ? "" : "ghost"}
                  onClick={() => setAudienceCategory(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="row">
            <label className="col-6 grid" style={{ gap: 6 }}>
              <span>Message</span>
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Write the CEO broadcast message..."
                style={{ minHeight: 130 }}
                required
              />
            </label>

            <div className="col-6 grid" style={{ gap: 10 }}>
              <label className="inline">
                <input
                  type="checkbox"
                  checked={useAiRouting}
                  onChange={(event) => setUseAiRouting(event.target.checked)}
                />
                AI route extraction
              </label>
              <label className="inline">
                <input
                  type="checkbox"
                  checked={useEnhancedForFallback}
                  onChange={(event) => setUseEnhancedForFallback(event.target.checked)}
                />
                Use enhanced text as fallback
              </label>
              <div className="kpi-grid">
                <article className="panel">
                  <p className="kpi-label">Selected Members</p>
                  <p className="kpi-value" style={{ fontSize: 22 }}>{selectedEmployeeIds.length}</p>
                </article>
                <article className="panel">
                  <p className="kpi-label">Selected Tags</p>
                  <p className="kpi-value" style={{ fontSize: 22 }}>{selectedTagKeys.length}</p>
                </article>
                <article className="panel">
                  <p className="kpi-label">Preview Reach</p>
                  <p className="kpi-value" style={{ fontSize: 22 }}>{routeRecipientCount}</p>
                </article>
              </div>
            </div>
          </div>

          <article className="panel grid" style={{ gap: 10 }}>
            <div className="inline" style={{ justifyContent: "space-between" }}>
              <strong>Recipient Selection</strong>
              <span className="muted">Industry-style multi-select controls</span>
            </div>

            <div className="row">
              <label className="col-4 grid" style={{ gap: 6 }}>
                <span>Category Tags (multi-select)</span>
                <select
                  multiple
                  size={Math.max(4, Math.min(7, tags.length))}
                  value={selectedTagKeys}
                  onChange={(event) => setSelectedTagKeys(parseMultiSelectValues(event.currentTarget))}
                >
                  {tags.map((tag) => (
                    <option key={tag.key} value={tag.key}>
                      {tag.label}
                    </option>
                  ))}
                </select>
                <div className="inline">
                  <button
                    className="ghost"
                    type="button"
                    onClick={() => setSelectedTagKeys(tags.map((tag) => tag.key))}
                  >
                    Select All Tags
                  </button>
                  <button className="ghost" type="button" onClick={() => setSelectedTagKeys([])}>
                    Clear Tags
                  </button>
                </div>
              </label>

              <div className="col-8 grid" style={{ gap: 6 }}>
                <span>Members</span>
                <div className="inline">
                  <input
                    className="input"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search name, number, department, designation"
                  />
                </div>
                <div className="inline">
                  <button className="ghost" type="button" onClick={() => setSelectedEmployeeIds(employees.map((item) => item.id))}>
                    Select All
                  </button>
                  <button
                    className="ghost"
                    type="button"
                    onClick={() => setSelectedEmployeeIds(filteredEmployees.map((item) => item.id))}
                  >
                    Select Filtered
                  </button>
                  <button className="ghost" type="button" onClick={() => setSelectedEmployeeIds([])}>
                    Clear Selection
                  </button>
                  <span className="muted">Showing {filteredEmployees.length}</span>
                </div>
                <div className="table-wrap" style={{ maxHeight: 280, overflowY: "auto" }}>
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: 70 }}>Pick</th>
                        <th>Name</th>
                        <th>Department</th>
                        <th>Designation</th>
                        <th>WhatsApp</th>
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
            </div>
          </article>

          <div className="inline" style={{ justifyContent: "space-between" }}>
            <button type="submit">Generate Preview</button>
            <span className="muted">{status}</span>
          </div>
        </form>
      </article>

      {preview ? (
        <article className="card grid" style={{ gap: 12 }} ref={reviewRef}>
          <div className="inline" style={{ justifyContent: "space-between" }}>
            <h2>Broadcast Review</h2>
            <span className="muted">
              Routes: {preview.routes.length} | Reach: {routeRecipientCount}
              {previewGeneratedAt ? ` | ${previewGeneratedAt}` : ""}
            </span>
          </div>

          <div className="row">
            <label className="col-8 grid" style={{ gap: 6 }}>
              <span>Enhanced Message</span>
              <textarea
                value={enhancedMessageDraft}
                onChange={(event) => setEnhancedMessageDraft(event.target.value)}
                style={{ minHeight: 180 }}
              />
            </label>

            <div className="col-4 grid" style={{ gap: 8 }}>
              <strong>Resolved Recipients ({preview.recipients.length})</strong>
              <div className="panel" style={{ maxHeight: 180, overflowY: "auto" }}>
                <div className="inline">
                  {preview.recipients.map((recipient) => (
                    <span className="pill" key={recipient.id}>{recipient.full_name}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {preview.unresolvedMentions.length ? (
            <p className="muted">Unresolved mentions: {preview.unresolvedMentions.join(", ")}</p>
          ) : null}
          {preview.unresolvedAiTargets.length ? (
            <p className="muted">Unresolved AI targets: {preview.unresolvedAiTargets.join(", ")}</p>
          ) : null}

          <div className="grid" style={{ gap: 10 }}>
            {preview.routes.map((route) => (
              <article className="card" key={route.routeId}>
                <div className="inline" style={{ justifyContent: "space-between" }}>
                  <label className="inline" style={{ fontWeight: 700 }}>
                    <input
                      type="checkbox"
                      checked={enabledRouteIds.includes(route.routeId)}
                      onChange={(event) => {
                        setEnabledRouteIds((prev) =>
                          event.target.checked
                            ? Array.from(new Set([...prev, route.routeId]))
                            : prev.filter((id) => id !== route.routeId),
                        );
                      }}
                    />
                    {route.targetLabel}
                  </label>
                  <span className="pill">{route.source} | {Math.round(route.confidence * 100)}%</span>
                </div>

                <p className="muted">
                  Recipients: {route.recipientEmployeeIds.length}
                  {route.recipientEmployeeIds.length
                    ? ` (${route.recipientEmployeeIds.slice(0, 6).map((id) => employeesById.get(id)?.full_name || id).join(", ")}${route.recipientEmployeeIds.length > 6 ? ", ..." : ""})`
                    : ""}
                </p>

                <textarea
                  value={routeMessageDrafts[route.routeId] ?? route.instruction}
                  onChange={(event) =>
                    setRouteMessageDrafts((prev) => ({
                      ...prev,
                      [route.routeId]: event.target.value,
                    }))
                  }
                  style={{ minHeight: 90 }}
                />
              </article>
            ))}
          </div>

          <div className="inline">
            <button type="button" onClick={() => void onSend()} disabled={sending}>
              {sending ? "Sending..." : "Send Broadcast"}
            </button>
            <span className="muted">Template: {templateName}</span>
          </div>
        </article>
      ) : null}
    </section>
  );
}
