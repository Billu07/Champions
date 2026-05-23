"use client";

import { useMemo, useState } from "react";

type Employee = {
  id: string;
  full_name: string;
  whatsapp_e164: string;
  department: string | null;
  designation: string | null;
  is_active: boolean;
};

type ConversationMessageEvent = {
  id: string;
  employeeId: string | null;
  direction: "inbound" | "outbound";
  category: string;
  slotKey: string | null;
  trackingDate: string | null;
  whatsappMessageId: string | null;
  messageText: string | null;
  occurredAt: string;
  unknownSender: string | null;
  replyContextMessageId: string | null;
  linkedOutboundMessageId: string | null;
  linkedOutboundCategory: string | null;
  classificationReason: string | null;
  failureReason: string | null;
};

type ConversationsBoardProps = {
  initialEmployees: Employee[];
  initialEvents: ConversationMessageEvent[];
};

type ThreadFamily = "all" | "scheduled" | "broadcast" | "general" | "unknown";

type ThreadSummary = {
  key: string;
  employeeId: string | null;
  unknownSender: string | null;
  label: string;
  subtitle: string;
  searchableText: string;
  events: ConversationMessageEvent[];
  lastAt: string;
  lastSnippet: string;
  lastDirection: "inbound" | "outbound";
  totalCount: number;
  inboundCount: number;
  outboundCount: number;
  familyCounts: Record<Exclude<ThreadFamily, "all">, number>;
};

const familyOptions: Array<{ value: ThreadFamily; label: string }> = [
  { value: "all", label: "All" },
  { value: "scheduled", label: "Scheduled" },
  { value: "broadcast", label: "Broadcast" },
  { value: "general", label: "General" },
  { value: "unknown", label: "Unknown" },
];

function safeDate(value: string): number {
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function shortTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function familyForCategory(category: string): Exclude<ThreadFamily, "all"> {
  if (
    category === "scheduled_prompt" ||
    category === "scheduled_general_prompt" ||
    category === "scheduled_reply" ||
    category === "scheduled_test_prompt"
  ) {
    return "scheduled";
  }

  if (
    category === "ceo_broadcast_template" ||
    category === "broadcast_reply" ||
    category === "scheduled_test_ceo_broadcast" ||
    category.startsWith("ceo_broadcast_status_")
  ) {
    return "broadcast";
  }

  if (category === "unknown_sender") return "unknown";
  return "general";
}

function statusFromBroadcastCategory(category: string): string {
  if (!category.startsWith("ceo_broadcast_status_")) return "";
  const status = category.replace("ceo_broadcast_status_", "").trim();
  return status || "status";
}

function eventSnippet(event: ConversationMessageEvent): string {
  const text = event.messageText?.trim();
  if (text) return text;

  if (event.category === "scheduled_prompt") return "Scheduled template sent";
  if (event.category === "scheduled_general_prompt") return "Scheduled custom prompt sent";
  if (event.category === "ceo_broadcast_template") return "CEO broadcast sent";
  if (event.category === "scheduled_reply") return "Scheduled reply received";
  if (event.category === "broadcast_reply") return "Broadcast reply received";
  if (event.category === "general_reply") return "General reply received";
  if (event.category === "unknown_sender") return "Message from unknown sender";

  const status = statusFromBroadcastCategory(event.category);
  if (status) {
    const reason = event.failureReason ? `: ${event.failureReason}` : "";
    return `Broadcast status ${status}${reason}`;
  }

  return event.category;
}

function bubbleText(event: ConversationMessageEvent): string {
  const text = event.messageText?.trim();
  if (text) return text;

  if (event.category === "scheduled_prompt") return "Scheduled template sent";
  if (event.category === "scheduled_general_prompt") return "Scheduled custom prompt sent";
  if (event.category === "ceo_broadcast_template") return "CEO broadcast template sent";
  if (event.category === "scheduled_reply") return "Scheduled reply received";
  if (event.category === "broadcast_reply") return "Broadcast reply received";
  if (event.category === "general_reply") return "General reply received";
  if (event.category === "unknown_sender") return "Unknown sender message";

  const status = statusFromBroadcastCategory(event.category);
  if (status) {
    const reason = event.failureReason ? ` | ${event.failureReason}` : "";
    return `Broadcast status: ${status}${reason}`;
  }

  return event.category;
}

function buildThreadKey(event: ConversationMessageEvent): string {
  if (event.employeeId) return `emp:${event.employeeId}`;
  if (event.unknownSender) return `unknown:${event.unknownSender}`;
  return "unknown:unmapped";
}

function truncate(value: string, max = 84): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

export function ConversationsBoard({ initialEmployees, initialEvents }: ConversationsBoardProps) {
  const [search, setSearch] = useState("");
  const [familyFilter, setFamilyFilter] = useState<ThreadFamily>("all");
  const [selectedThreadKey, setSelectedThreadKey] = useState("");

  const employeesById = useMemo(() => {
    return new Map(initialEmployees.map((employee) => [employee.id, employee]));
  }, [initialEmployees]);

  const threads = useMemo(() => {
    const eventsSorted = [...initialEvents].sort((a, b) => safeDate(b.occurredAt) - safeDate(a.occurredAt));
    const map = new Map<string, ThreadSummary>();

    for (const event of eventsSorted) {
      const key = buildThreadKey(event);
      const employee = event.employeeId ? employeesById.get(event.employeeId) : null;
      const family = familyForCategory(event.category);

      const label = employee
        ? employee.full_name
        : event.unknownSender
          ? `Unknown Sender ${event.unknownSender}`
          : "Unknown Sender";

      const subtitle = employee
        ? `${employee.designation || "Member"}${employee.department ? `, ${employee.department}` : ""}${employee.whatsapp_e164 ? ` | ${employee.whatsapp_e164}` : ""}`
        : event.unknownSender || "No employee mapping";

      const searchableText = `${label} ${subtitle} ${eventSnippet(event)}`.toLowerCase();

      if (!map.has(key)) {
        map.set(key, {
          key,
          employeeId: employee?.id ?? null,
          unknownSender: event.unknownSender,
          label,
          subtitle,
          searchableText,
          events: [event],
          lastAt: event.occurredAt,
          lastSnippet: eventSnippet(event),
          lastDirection: event.direction,
          totalCount: 1,
          inboundCount: event.direction === "inbound" ? 1 : 0,
          outboundCount: event.direction === "outbound" ? 1 : 0,
          familyCounts: {
            scheduled: family === "scheduled" ? 1 : 0,
            broadcast: family === "broadcast" ? 1 : 0,
            general: family === "general" ? 1 : 0,
            unknown: family === "unknown" ? 1 : 0,
          },
        });
        continue;
      }

      const summary = map.get(key)!;
      summary.events.push(event);
      summary.totalCount += 1;
      if (event.direction === "inbound") summary.inboundCount += 1;
      if (event.direction === "outbound") summary.outboundCount += 1;
      summary.familyCounts[family] += 1;
      summary.searchableText = `${summary.searchableText} ${eventSnippet(event).toLowerCase()}`;
    }

    return Array.from(map.values())
      .map((thread) => ({
        ...thread,
        events: [...thread.events].sort((a, b) => safeDate(a.occurredAt) - safeDate(b.occurredAt)),
      }))
      .sort((a, b) => safeDate(b.lastAt) - safeDate(a.lastAt));
  }, [employeesById, initialEvents]);

  const filteredThreads = useMemo(() => {
    const q = search.trim().toLowerCase();

    return threads.filter((thread) => {
      if (familyFilter !== "all" && thread.familyCounts[familyFilter] === 0) {
        return false;
      }

      if (!q) return true;
      return thread.searchableText.includes(q);
    });
  }, [threads, familyFilter, search]);

  const countsByFamily = useMemo(() => {
    return {
      all: threads.length,
      scheduled: threads.filter((thread) => thread.familyCounts.scheduled > 0).length,
      broadcast: threads.filter((thread) => thread.familyCounts.broadcast > 0).length,
      general: threads.filter((thread) => thread.familyCounts.general > 0).length,
      unknown: threads.filter((thread) => thread.familyCounts.unknown > 0).length,
    };
  }, [threads]);

  const effectiveSelectedThreadKey = useMemo(() => {
    if (!filteredThreads.length) return "";
    return filteredThreads.some((thread) => thread.key === selectedThreadKey)
      ? selectedThreadKey
      : filteredThreads[0].key;
  }, [filteredThreads, selectedThreadKey]);

  const selectedThread = useMemo(
    () => filteredThreads.find((thread) => thread.key === effectiveSelectedThreadKey) ?? null,
    [filteredThreads, effectiveSelectedThreadKey],
  );

  return (
    <section className="grid conversations-board" style={{ gap: 14 }}>
      <article className="card grid conversations-toolbar" style={{ gap: 10 }}>
        <div className="inline" style={{ justifyContent: "space-between" }}>
          <h2>WhatsApp Conversations</h2>
          <span className="pill">Threads: {filteredThreads.length}</span>
        </div>

        <div className="row">
          <label className="col-6 grid" style={{ gap: 6 }}>
            <span>Search</span>
            <input
              className="input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search employee, sender number, or message"
            />
          </label>

          <div className="col-6 grid" style={{ gap: 6 }}>
            <span>Filter</span>
            <div className="inline">
              {familyOptions.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={familyFilter === item.value ? "" : "ghost"}
                  onClick={() => setFamilyFilter(item.value)}
                >
                  {item.label} ({countsByFamily[item.value]})
                </button>
              ))}
            </div>
          </div>
        </div>
      </article>

      <section className="conversation-shell">
        <aside className="card conversation-sidebar">
          <div className="inline" style={{ justifyContent: "space-between" }}>
            <strong>Threads</strong>
            <span className="muted">{filteredThreads.length}</span>
          </div>

          <div className="conversation-thread-list">
            {filteredThreads.length ? filteredThreads.map((thread) => (
              <button
                key={thread.key}
                type="button"
                className={`conversation-thread-item ${effectiveSelectedThreadKey === thread.key ? "active" : ""}`}
                onClick={() => setSelectedThreadKey(thread.key)}
              >
                <div className="inline" style={{ justifyContent: "space-between", width: "100%" }}>
                  <strong>{thread.label}</strong>
                  <span className="muted" style={{ fontSize: 12 }}>{shortTime(thread.lastAt)}</span>
                </div>
                <p className="muted" style={{ margin: 0 }}>{thread.subtitle}</p>
                <p style={{ margin: 0, color: "#1f344a", fontSize: 13 }}>{truncate(thread.lastSnippet)}</p>
                <div className="inline" style={{ gap: 6 }}>
                  {thread.familyCounts.scheduled > 0 ? <span className="pill">Scheduled</span> : null}
                  {thread.familyCounts.broadcast > 0 ? <span className="pill">Broadcast</span> : null}
                  {thread.familyCounts.general > 0 ? <span className="pill">General</span> : null}
                  {thread.familyCounts.unknown > 0 ? <span className="pill">Unknown</span> : null}
                </div>
              </button>
            )) : (
              <p className="muted">No conversation threads match this filter.</p>
            )}
          </div>
        </aside>

        <article className="card conversation-pane">
          {selectedThread ? (
            <>
              <div className="conversation-pane-head">
                <div>
                  <h2 style={{ marginBottom: 4 }}>{selectedThread.label}</h2>
                  <p className="muted" style={{ margin: 0 }}>{selectedThread.subtitle}</p>
                </div>
                <div className="inline">
                  <span className="pill">Total {selectedThread.totalCount}</span>
                  <span className="pill">Inbound {selectedThread.inboundCount}</span>
                  <span className="pill">Outbound {selectedThread.outboundCount}</span>
                </div>
              </div>

              <div className="conversation-log">
                {selectedThread.events.map((event) => {
                  const status = statusFromBroadcastCategory(event.category);
                  const isStatus = Boolean(status);
                  const family = familyForCategory(event.category);

                  if (isStatus) {
                    return (
                      <div key={event.id} className="conversation-status-row">
                        <span className="pill">
                          Broadcast {status}
                          {event.failureReason ? ` | ${event.failureReason}` : ""}
                        </span>
                        <span className="muted" style={{ fontSize: 12 }}>{formatDateTime(event.occurredAt)}</span>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={event.id}
                      className={`conversation-message-row ${event.direction === "outbound" ? "outbound" : "inbound"}`}
                    >
                      <article className={`conversation-bubble ${event.direction === "outbound" ? "outbound" : "inbound"}`}>
                        <p style={{ margin: 0, color: "#0f2238", whiteSpace: "pre-wrap" }}>{bubbleText(event)}</p>
                        <div className="inline" style={{ justifyContent: "space-between", marginTop: 8 }}>
                          <span className="muted" style={{ fontSize: 12 }}>{family}</span>
                          <span className="muted" style={{ fontSize: 12 }}>{formatDateTime(event.occurredAt)}</span>
                        </div>
                        {event.slotKey ? (
                          <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
                            Slot: {event.slotKey}{event.trackingDate ? ` | Date: ${event.trackingDate}` : ""}
                          </p>
                        ) : null}
                        {event.direction === "inbound" && event.classificationReason ? (
                          <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
                            Classification: {event.category} ({event.classificationReason})
                          </p>
                        ) : null}
                      </article>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="conversation-empty">
              <p className="muted">Select a thread to view conversation timeline.</p>
            </div>
          )}
        </article>
      </section>
    </section>
  );
}
