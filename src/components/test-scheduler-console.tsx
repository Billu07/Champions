"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { SlotKey } from "@/lib/types";

type Employee = {
  id: string;
  full_name: string;
  whatsapp_e164: string;
  designation: string | null;
  department: string | null;
  is_active: boolean;
  tracking_enabled: boolean;
  is_test_allowed: boolean;
};

type Schedule = {
  id: string;
  jobKey: string;
  status: "running" | "success" | "failed";
  note: string | null;
  slot: SlotKey | null;
  scheduledAtIso: string | null;
  createdAt: string;
  finishedAt: string | null;
  recipientCount: number;
  recipients: Array<{
    id: string;
    full_name: string;
    whatsapp_e164: string;
  }>;
};

type DispatchResponse = {
  ok: true;
  result: {
    due: number;
    processed: number;
    sent: number;
    failed: number;
    skipped: number;
  };
};

type TestSchedulerConsoleProps = {
  initialEmployees: Employee[];
  initialSchedules: Schedule[];
  timezone: string;
  defaultMorningBodyText: string;
};

const slotOptions: Array<{ key: SlotKey; label: string }> = [
  { key: "morning", label: "Morning" },
  { key: "noon", label: "Noon" },
  { key: "afternoon", label: "Afternoon" },
  { key: "evening", label: "Evening" },
];

function pad(num: number): string {
  return String(num).padStart(2, "0");
}

function localDateTimeInputValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultScheduleInput(): string {
  const base = new Date(Date.now() + 2 * 60 * 1000);
  base.setSeconds(0, 0);
  return localDateTimeInputValue(base);
}

function toDisplayDate(iso: string | null): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

export function TestSchedulerConsole({
  initialEmployees,
  initialSchedules,
  timezone,
  defaultMorningBodyText,
}: TestSchedulerConsoleProps) {
  const [employees] = useState<Employee[]>(initialEmployees);
  const [schedules, setSchedules] = useState<Schedule[]>(initialSchedules);

  const [slot, setSlot] = useState<SlotKey>("morning");
  const [scheduledAtLocal, setScheduledAtLocal] = useState(defaultScheduleInput());
  const [morningBodyText, setMorningBodyText] = useState(defaultMorningBodyText);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>(
    initialEmployees.filter((item) => item.is_test_allowed).map((item) => item.id),
  );
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [autoDispatch, setAutoDispatch] = useState(true);

  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;

    return employees.filter((employee) => {
      return (
        employee.full_name.toLowerCase().includes(q) ||
        employee.whatsapp_e164.toLowerCase().includes(q) ||
        String(employee.designation || "").toLowerCase().includes(q)
      );
    });
  }, [employees, search]);

  const pendingCount = useMemo(() => schedules.filter((item) => item.status === "running").length, [schedules]);

  const loadSchedules = useCallback(async () => {
    const res = await fetch("/api/test-schedules", { cache: "no-store" });
    const json = await res.json();
    if (!res.ok) {
      setStatus(json.error || "Failed to load schedules");
      return;
    }
    setSchedules(json.schedules || []);
  }, []);

  const dispatchDue = useCallback(async (silent = false) => {
    const res = await fetch("/api/test-schedules/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    const json = (await res.json().catch(() => ({}))) as DispatchResponse | { error?: string };
    if (!res.ok) {
      if (!silent) setStatus((json as { error?: string }).error || "Dispatch failed");
      return;
    }

    const result = (json as DispatchResponse).result;
    if (!silent) {
      setStatus(
        `Dispatch done: due=${result.due}, processed=${result.processed}, sent=${result.sent}, failed=${result.failed}`,
      );
    }

    if (result.processed > 0) {
      await loadSchedules();
    }
  }, [loadSchedules]);

  async function onCreateSchedule(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setStatus("");

    if (selectedEmployeeIds.length === 0) {
      setStatus("Select at least one recipient.");
      setSaving(false);
      return;
    }

    const scheduledDate = new Date(scheduledAtLocal);
    if (Number.isNaN(scheduledDate.getTime())) {
      setStatus("Invalid schedule date/time.");
      setSaving(false);
      return;
    }

    const res = await fetch("/api/test-schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slot,
        scheduledAtIso: scheduledDate.toISOString(),
        recipientEmployeeIds: selectedEmployeeIds,
        morningBodyText,
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(json.error || "Failed to create schedule");
      setSaving(false);
      return;
    }

    setStatus(`Scheduled for ${toDisplayDate(scheduledDate.toISOString())}.`);
    setScheduledAtLocal(defaultScheduleInput());
    await loadSchedules();
    setSaving(false);
  }

  async function onCancel(id: string) {
    const res = await fetch(`/api/test-schedules/${id}`, { method: "DELETE" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(json.error || "Failed to cancel schedule");
      return;
    }
    setStatus("Schedule cancelled.");
    await loadSchedules();
  }

  useEffect(() => {
    if (!autoDispatch) return;

    const timer = setInterval(() => {
      void dispatchDue(true);
    }, 30_000);

    return () => clearInterval(timer);
  }, [autoDispatch, dispatchDue]);

  return (
    <section className="grid" style={{ gap: 16 }}>
      <article className="card grid" style={{ gap: 12 }}>
        <h2>Create Test Schedule</h2>
        <p>
          Choose recipients, pick slot template, and set schedule time. Auto-dispatch works while this page stays open.
          Timezone target: {timezone}
        </p>

        <form className="grid" onSubmit={onCreateSchedule}>
          <div className="row">
            <label className="col-4 grid" style={{ gap: 6 }}>
              <span>Slot</span>
              <select value={slot} onChange={(event) => setSlot(event.target.value as SlotKey)}>
                {slotOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="col-4 grid" style={{ gap: 6 }}>
              <span>Schedule At</span>
              <input
                className="input"
                type="datetime-local"
                value={scheduledAtLocal}
                onChange={(event) => setScheduledAtLocal(event.target.value)}
                required
              />
            </label>

            <div className="col-4 grid" style={{ gap: 6 }}>
              <span>Actions</span>
              <div className="inline">
                <button disabled={saving} type="submit">
                  {saving ? "Scheduling..." : "Add Schedule"}
                </button>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => {
                    void dispatchDue(false);
                  }}
                >
                  Run Due Now
                </button>
              </div>
            </div>
          </div>

          {slot === "morning" ? (
            <label className="grid" style={{ gap: 6 }}>
              <span>Morning Template `{"{{body}}"}` Text</span>
              <textarea
                value={morningBodyText}
                onChange={(event) => setMorningBodyText(event.target.value)}
                style={{ minHeight: 120 }}
              />
            </label>
          ) : null}

          <div className="inline">
            <label className="inline">
              <input
                type="checkbox"
                checked={autoDispatch}
                onChange={(event) => setAutoDispatch(event.target.checked)}
              />
              Auto-dispatch every 30s
            </label>
            <button className="ghost" type="button" onClick={() => void loadSchedules()}>
              Refresh List
            </button>
            <span className="muted">{status}</span>
          </div>

          <div className="grid" style={{ gap: 8 }}>
            <strong>Recipients ({selectedEmployeeIds.length} selected)</strong>

            <div className="row">
              <label className="col-6 grid" style={{ gap: 6 }}>
                <span>Search</span>
                <input
                  className="input"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Name / number / designation"
                />
              </label>

              <div className="col-6 grid" style={{ gap: 6 }}>
                <span>Quick Select</span>
                <div className="inline">
                  <button
                    className="ghost"
                    type="button"
                    onClick={() =>
                      setSelectedEmployeeIds(filteredEmployees.map((item) => item.id))
                    }
                  >
                    Select Filtered
                  </button>
                  <button
                    className="ghost"
                    type="button"
                    onClick={() =>
                      setSelectedEmployeeIds(
                        employees.filter((item) => item.is_test_allowed).map((item) => item.id),
                      )
                    }
                  >
                    Select Allowed
                  </button>
                  <button className="ghost" type="button" onClick={() => setSelectedEmployeeIds([])}>
                    Clear
                  </button>
                </div>
              </div>
            </div>

            <div className="inline">
              {filteredEmployees.map((employee) => (
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
                  {employee.is_test_allowed ? " (allowed)" : ""}
                </label>
              ))}
            </div>
          </div>
        </form>
      </article>

      <article className="card grid" style={{ gap: 10 }}>
        <h2>Schedule Queue</h2>
        <p>Pending: {pendingCount}</p>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Slot</th>
                <th>Recipients</th>
                <th>Status</th>
                <th>Note</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {schedules.length ? (
                schedules.map((item) => (
                  <tr key={item.id}>
                    <td>{toDisplayDate(item.scheduledAtIso)}</td>
                    <td>{item.slot || "-"}</td>
                    <td>
                      {item.recipients.length
                        ? item.recipients.map((row) => row.full_name).join(", ")
                        : `${item.recipientCount} selected`}
                    </td>
                    <td>{item.status}</td>
                    <td>{item.note || "-"}</td>
                    <td>
                      {item.status === "running" ? (
                        <button className="danger" onClick={() => void onCancel(item.id)}>
                          Cancel
                        </button>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6}>No schedules yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}
