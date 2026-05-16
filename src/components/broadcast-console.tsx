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

const audienceOptions: Array<{ value: BroadcastAudienceCategory; label: string; hint: string }> = [
  { value: "sales_team", label: "Sales Team", hint: "All active members tagged Sales Field" },
  { value: "head_office", label: "HO Team", hint: "All active members tagged Head Office" },
  { value: "drivers", label: "Drivers", hint: "All active members tagged Drivers" },
  { value: "customers", label: "Customers", hint: "All active members tagged Customers" },
  { value: "all", label: "All", hint: "Everyone active in roster" },
  { value: "custom", label: "Custom", hint: "Manual/tag/mention based targeting" },
];

function tagLabelFromCategory(category: BroadcastAudienceCategory): string {
  if (category === "sales_team") return "sales_field";
  if (category === "head_office") return "head_office";
  if (category === "drivers") return "drivers";
  if (category === "customers") return "customers";
  return "";
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

  const selectedRecipientsCount = useMemo(() => {
    return new Set(selectedEmployeeIds).size;
  }, [selectedEmployeeIds]);

  async function onPreview(event: FormEvent) {
    event.preventDefault();
    setStatus("Generating preview...");

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
    setRouteMessageDrafts(
      Object.fromEntries(parsed.routes.map((route) => [route.routeId, route.instruction])),
    );
    setEnabledRouteIds(parsed.routes.map((route) => route.routeId));
    setStatus(`Preview ready: ${parsed.routes.length} routes, ${parsed.recipients.length} recipients.`);

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
            message:
              draft ||
              (useEnhancedForFallback && fallbackEnhance ? enhancedMessageDraft : message),
          };
        })
        .filter((route) => route.recipientEmployeeIds.length > 0 && route.message.length > 0);

      if (reviewedRoutes.length === 0) {
        setStatus("No valid reviewed routes selected for sending.");
        return;
      }

      setStatus("Sending template broadcast...");

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
        `Campaign ${(json as { campaignId: string }).campaignId}: accepted=${accepted}, failed=${failed}. Final delivery updates from webhook status.`,
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="grid" style={{ gap: 16 }}>
      <div className="kpi-grid">
        <article className="card kpi-card">
          <p className="kpi-label">Active Members</p>
          <p className="kpi-value">{employees.length}</p>
        </article>
        <article className="card kpi-card">
          <p className="kpi-label">Manual Selected</p>
          <p className="kpi-value">{selectedRecipientsCount}</p>
        </article>
        <article className="card kpi-card">
          <p className="kpi-label">Tags Selected</p>
          <p className="kpi-value">{selectedTagKeys.length}</p>
        </article>
        <article className="card kpi-card">
          <p className="kpi-label">Preview Routes</p>
          <p className="kpi-value">{preview?.routes.length ?? 0}</p>
          <p className="kpi-sub">Recipients reach: {routeRecipientCount}</p>
        </article>
      </div>

      <form className="card grid" onSubmit={onPreview} style={{ gap: 12 }}>
        <h2>CEO Broadcast Composer</h2>
        <p>
          Write one instruction. AI will split by recipient and produce Bengali enhancement for your final review.
        </p>

        <div className="row">
          <label className="col-4 grid" style={{ gap: 6 }}>
            <span>Audience Category</span>
            <select
              value={audienceCategory}
              onChange={(event) => setAudienceCategory(event.target.value as BroadcastAudienceCategory)}
            >
              {audienceOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} - {option.hint}
                </option>
              ))}
            </select>
          </label>

          <div className="col-8 inline" style={{ alignItems: "flex-end" }}>
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
              Use Bengali enhancement for fallback route text
            </label>
          </div>
        </div>

        <label className="grid" style={{ gap: 6 }}>
          <span>Original CEO Message</span>
          <textarea value={message} onChange={(event) => setMessage(event.target.value)} required />
        </label>

        <details className="panel">
          <summary>Optional Recipient Filters</summary>
          <div className="grid" style={{ gap: 10, marginTop: 10 }}>
            <div className="grid" style={{ gap: 8 }}>
              <strong>Tags</strong>
              <div className="inline">
                {tags.map((tag) => (
                  <label key={tag.key} className="pill inline">
                    <input
                      type="checkbox"
                      checked={selectedTagKeys.includes(tag.key)}
                      onChange={(event) => {
                        setSelectedTagKeys((prev) =>
                          event.target.checked
                            ? Array.from(new Set([...prev, tag.key]))
                            : prev.filter((key) => key !== tag.key),
                        );
                      }}
                    />
                    {tag.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="grid" style={{ gap: 8 }}>
              <strong>Manual Members</strong>
              <input
                className="input"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search members"
              />
              <div className="inline">
                <button
                  className="ghost"
                  type="button"
                  onClick={() => setSelectedEmployeeIds(filteredEmployees.map((employee) => employee.id))}
                >
                  Select Filtered
                </button>
                <button className="ghost" type="button" onClick={() => setSelectedEmployeeIds([])}>
                  Clear
                </button>
                <span className="muted">Selected: {selectedEmployeeIds.length}</span>
              </div>
              <div className="panel" style={{ maxHeight: 180, overflowY: "auto" }}>
                <div className="inline">
                  {filteredEmployees.slice(0, 120).map((employee) => (
                    <label key={employee.id} className="pill inline">
                      <input
                        type="checkbox"
                        checked={selectedEmployeeIds.includes(employee.id)}
                        onChange={(event) => {
                          setSelectedEmployeeIds((prev) =>
                            event.target.checked
                              ? Array.from(new Set([...prev, employee.id]))
                              : prev.filter((id) => id !== employee.id),
                          );
                        }}
                      />
                      {employee.full_name}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </details>

        <div className="inline" style={{ justifyContent: "space-between" }}>
          <button type="submit">Preview Broadcast Plan</button>
          <span className="muted">{status}</span>
        </div>
      </form>

      {preview ? (
        <article className="card grid" style={{ gap: 12 }} ref={reviewRef}>
          <div className="inline" style={{ justifyContent: "space-between" }}>
            <h2>Enhanced Message + Recipients</h2>
            <p>
              Enabled routes: {enabledRouteIds.length} | Recipient reach: {routeRecipientCount}
              {previewGeneratedAt ? ` | Previewed: ${previewGeneratedAt}` : ""}
            </p>
          </div>

          <div className="row">
            <div className="col-8 grid" style={{ gap: 6 }}>
              <strong>Enhanced Bengali Message (Editable)</strong>
              <textarea
                value={enhancedMessageDraft}
                onChange={(event) => setEnhancedMessageDraft(event.target.value)}
                style={{ minHeight: 180 }}
              />
            </div>
            <div className="col-4 grid" style={{ gap: 8 }}>
              <strong>Resolved Recipients ({preview.recipients.length})</strong>
              <div className="panel" style={{ maxHeight: 180, overflowY: "auto" }}>
                <div className="inline">
                  {preview.recipients.map((item) => (
                    <span className="pill" key={item.id}>{item.full_name}</span>
                  ))}
                </div>
              </div>

              <strong>Mention Matches</strong>
              <div className="panel" style={{ maxHeight: 120, overflowY: "auto" }}>
                <div className="inline">
                  {preview.mentionMatches.length
                    ? preview.mentionMatches.map((match) => (
                      <span className="pill" key={`${match.employeeId}-${match.fullName}`}>{match.fullName}</span>
                    ))
                    : <span className="muted">No explicit mention match.</span>}
                </div>
              </div>
            </div>
          </div>

          {preview.unresolvedMentions.length ? (
            <div className="panel">
              <strong>Unresolved Mentions:</strong> {preview.unresolvedMentions.join(", ")}
            </div>
          ) : null}

          {preview.unresolvedAiTargets.length ? (
            <div className="panel">
              <strong>Unresolved AI Targets:</strong> {preview.unresolvedAiTargets.join(", ")}
            </div>
          ) : null}

          <div className="grid" style={{ gap: 10 }}>
            {preview.routes.map((route) => (
              <div className="panel" key={route.routeId}>
                <div className="inline" style={{ justifyContent: "space-between" }}>
                  <label className="inline" style={{ fontWeight: 600 }}>
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
                  <span className="pill">
                    {route.source} | {Math.round(route.confidence * 100)}%
                  </span>
                </div>

                <p className="muted">
                  Recipients: {route.recipientEmployeeIds.length}
                  {route.recipientEmployeeIds.length
                    ? ` (${route.recipientEmployeeIds
                        .slice(0, 6)
                        .map((id) => employeesById.get(id)?.full_name || id)
                        .join(", ")}${route.recipientEmployeeIds.length > 6 ? ", ..." : ""})`
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
              </div>
            ))}
          </div>

          <div className="inline">
            <button onClick={onSend} disabled={sending}>
              {sending ? "Sending..." : "Send Broadcast"}
            </button>
            <span className="muted">Template: {templateName}</span>
          </div>
        </article>
      ) : null}
    </section>
  );
}
