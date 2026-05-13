"use client";

import { FormEvent, useMemo, useState } from "react";
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

export function BroadcastConsole({ initialEmployees, initialTags }: BroadcastConsoleProps) {
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
  const [useEnhancedForFallback, setUseEnhancedForFallback] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("");

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
    setRouteMessageDrafts(
      Object.fromEntries(parsed.routes.map((route) => [route.routeId, route.instruction])),
    );
    setEnabledRouteIds(parsed.routes.map((route) => route.routeId));
    setStatus(`Preview ready: ${parsed.routes.length} routes, ${parsed.recipients.length} recipients.`);
  }

  async function onSend() {
    if (!preview) return;

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
            (useEnhancedForFallback && fallbackEnhance ? preview.enhancedMessage : message),
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
        finalMessage: useEnhancedForFallback ? preview.enhancedMessage : message,
        audienceCategory,
        reviewedRoutes,
      }),
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      setStatus((json as { error?: string }).error ?? "Broadcast failed");
      return;
    }

    setStatus(
      `Campaign ${(json as { campaignId: string }).campaignId}: sent=${(json as { sent: number }).sent}, failed=${(json as { failed: number }).failed}`,
    );
  }

  return (
    <section className="grid" style={{ gap: 16 }}>
      <form className="card grid" onSubmit={onPreview} style={{ gap: 12 }}>
        <h2>CEO Broadcast Composer</h2>
        <p>
          Write one message. The system can split it into person/group routes, map names from employee records,
          and require review before sending.
        </p>

        <label className="grid" style={{ gap: 6 }}>
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

        <label className="grid" style={{ gap: 6 }}>
          <span>Message</span>
          <textarea value={message} onChange={(event) => setMessage(event.target.value)} required />
        </label>

        <div className="row">
          <div className="col-6 grid" style={{ gap: 8 }}>
            <strong>Tag Selection (optional)</strong>
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

          <div className="col-6 grid" style={{ gap: 8 }}>
            <strong>Manual Recipients (optional)</strong>
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
            </div>
            <div className="inline">
              {filteredEmployees.slice(0, 50).map((employee) => (
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

        <div className="inline" style={{ justifyContent: "space-between" }}>
          <div className="inline">
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
              AI-enhance fallback routes
            </label>
            <button type="submit">Preview Routes</button>
          </div>
          <span className="muted">{status}</span>
        </div>
      </form>

      {preview ? (
        <article className="card grid" style={{ gap: 12 }}>
          <div className="inline" style={{ justifyContent: "space-between" }}>
            <h2>Review Before Send</h2>
            <p>
              Enabled routes: {enabledRouteIds.length} | Recipient reach: {routeRecipientCount}
            </p>
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
                        .slice(0, 4)
                        .map((id) => employeesById.get(id)?.full_name || id)
                        .join(", ")}${route.recipientEmployeeIds.length > 4 ? ", ..." : ""})`
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

          <details>
            <summary>Enhanced Full Message</summary>
            <pre>{preview.enhancedMessage}</pre>
          </details>

          <div className="inline">
            <button onClick={onSend}>Send Broadcast</button>
            <span className="muted">Template: `WHATSAPP_BROADCAST_TEMPLATE_NAME`</span>
          </div>
        </article>
      ) : null}
    </section>
  );
}
