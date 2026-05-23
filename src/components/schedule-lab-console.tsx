"use client";

import { FormEvent, useMemo, useState } from "react";

type ScheduleSlot = "morning" | "noon" | "afternoon" | "evening";

type ScheduleEntry = {
  id: string;
  label: string;
  minuteOfDay: number;
  timeHHmm: string;
  bodyText: string;
  templateName: string;
  languageCode: string;
  isActive: boolean;
  legacySlotKey: ScheduleSlot | null;
  reportSlotKey: string | null;
  reportMandatory: boolean;
  reportCritical: boolean;
  reportWeight: number;
  createdAt: string;
  updatedAt: string;
};

type ScheduleLabConsoleProps = {
  initialSchedules: ScheduleEntry[];
  initialError?: string | null;
};

const slotOptions: Array<{ value: ScheduleSlot; label: string }> = [
  { value: "morning", label: "Morning" },
  { value: "noon", label: "Noon" },
  { value: "afternoon", label: "Afternoon" },
  { value: "evening", label: "Evening" },
];

const defaultForm = {
  label: "",
  timeHHmm: "08:00",
  bodyText: "",
  templateName: "ceo_template",
  languageCode: "en",
  isActive: true,
  reportSlotKey: "",
  reportMandatory: true,
  reportCritical: false,
  reportWeight: "1",
  legacySlotKey: "" as "" | ScheduleSlot,
};

function normalizeReportSlotInput(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function timeLabel(timeHHmm: string): string {
  const [hhRaw, mmRaw] = timeHHmm.split(":");
  const hh = Number(hhRaw);
  const mm = Number(mmRaw);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return timeHHmm;
  const suffix = hh >= 12 ? "PM" : "AM";
  const hour12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${hour12}:${String(mm).padStart(2, "0")} ${suffix}`;
}

function scheduleSort(a: ScheduleEntry, b: ScheduleEntry): number {
  if (a.minuteOfDay !== b.minuteOfDay) return a.minuteOfDay - b.minuteOfDay;
  return a.label.localeCompare(b.label);
}

export function ScheduleLabConsole({ initialSchedules, initialError }: ScheduleLabConsoleProps) {
  const [schedules, setSchedules] = useState<ScheduleEntry[]>([...initialSchedules].sort(scheduleSort));
  const [status, setStatus] = useState(initialError ?? "Manage schedule dispatch in Asia/Dhaka timezone.");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string>("");
  const [form, setForm] = useState(defaultForm);
  const [editForm, setEditForm] = useState(defaultForm);

  const activeCount = useMemo(() => schedules.filter((item) => item.isActive).length, [schedules]);

  async function reload() {
    setLoading(true);
    try {
      const res = await fetch("/api/schedule-lab", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus((json as { error?: string }).error ?? "Failed to load schedules.");
        return;
      }
      const next = ((json as { schedules?: ScheduleEntry[] }).schedules ?? []).sort(scheduleSort);
      setSchedules(next);
    } finally {
      setLoading(false);
    }
  }

  function resetCreateForm() {
    setForm(defaultForm);
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setStatus("");

    const payload = {
      label: form.label.trim(),
      timeHHmm: form.timeHHmm,
      bodyText: form.bodyText.trim(),
      templateName: form.templateName.trim() || "ceo_template",
      languageCode: form.languageCode.trim() || "en",
      isActive: form.isActive,
      reportSlotKey: form.reportSlotKey ? normalizeReportSlotInput(form.reportSlotKey) : null,
      reportMandatory: form.reportMandatory,
      reportCritical: form.reportCritical,
      reportWeight: Number(form.reportWeight || "0"),
      legacySlotKey: form.legacySlotKey || null,
    };

    const res = await fetch("/api/schedule-lab", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus((json as { error?: string }).error ?? "Failed to create schedule.");
      setSaving(false);
      return;
    }

    setStatus("Schedule created.");
    resetCreateForm();
    await reload();
    setSaving(false);
  }

  function beginEdit(item: ScheduleEntry) {
    setEditingId(item.id);
    setEditForm({
      label: item.label,
      timeHHmm: item.timeHHmm,
      bodyText: item.bodyText,
      templateName: item.templateName,
      languageCode: item.languageCode,
      isActive: item.isActive,
      reportSlotKey: item.reportSlotKey ?? "",
      reportMandatory: item.reportMandatory,
      reportCritical: item.reportCritical,
      reportWeight: String(item.reportWeight ?? 1),
      legacySlotKey: item.legacySlotKey ?? "",
    });
  }

  async function onSaveEdit(id: string) {
    setSaving(true);
    setStatus("");

    const payload = {
      label: editForm.label.trim(),
      timeHHmm: editForm.timeHHmm,
      bodyText: editForm.bodyText.trim(),
      templateName: editForm.templateName.trim() || "ceo_template",
      languageCode: editForm.languageCode.trim() || "en",
      isActive: editForm.isActive,
      reportSlotKey: editForm.reportSlotKey ? normalizeReportSlotInput(editForm.reportSlotKey) : null,
      reportMandatory: editForm.reportMandatory,
      reportCritical: editForm.reportCritical,
      reportWeight: Number(editForm.reportWeight || "0"),
      legacySlotKey: editForm.legacySlotKey || null,
    };

    const res = await fetch(`/api/schedule-lab/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      setStatus((json as { error?: string }).error ?? "Failed to update schedule.");
      setSaving(false);
      return;
    }

    setStatus("Schedule updated.");
    setEditingId("");
    await reload();
    setSaving(false);
  }

  async function onToggleActive(item: ScheduleEntry) {
    setSaving(true);
    setStatus("");
    const res = await fetch(`/api/schedule-lab/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !item.isActive }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus((json as { error?: string }).error ?? "Failed to update schedule status.");
      setSaving(false);
      return;
    }
    setStatus(`Schedule ${!item.isActive ? "activated" : "deactivated"}.`);
    await reload();
    setSaving(false);
  }

  async function onDelete(item: ScheduleEntry) {
    const confirmed = window.confirm(`Delete schedule "${item.label}"?`);
    if (!confirmed) return;

    setSaving(true);
    setStatus("");
    const res = await fetch(`/api/schedule-lab/${item.id}`, { method: "DELETE" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus((json as { error?: string }).error ?? "Failed to delete schedule.");
      setSaving(false);
      return;
    }

    if (editingId === item.id) {
      setEditingId("");
    }

    setStatus("Schedule deleted.");
    await reload();
    setSaving(false);
  }

  return (
    <section className="grid schedule-lab" style={{ gap: 14 }}>
      <article className="card">
        <div className="inline" style={{ justifyContent: "space-between" }}>
          <h2>Schedule Lab</h2>
          <div className="inline">
            <span className="pill">Timezone: Asia/Dhaka</span>
            <span className="pill">Active: {activeCount}</span>
            <button type="button" className="ghost" onClick={() => void reload()} disabled={loading || saving}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>
        <p className="muted" style={{ margin: "8px 0 0" }}>
          Use the CEO template format ({`Hi {employee_name}, {body}`}) for all schedule messages.
        </p>
        <p className="muted" style={{ margin: "6px 0 0" }}>{status}</p>
      </article>

      <form className="card grid schedule-lab-create" style={{ gap: 10 }} onSubmit={onCreate}>
        <h2>Create Schedule</h2>
        <div className="row">
          <label className="col-4 grid" style={{ gap: 6 }}>
            <span>Label</span>
            <input
              className="input"
              value={form.label}
              onChange={(event) => setForm((prev) => ({ ...prev, label: event.target.value }))}
              placeholder="Example: Noon sales check-in"
              required
            />
          </label>
          <label className="col-2 grid" style={{ gap: 6 }}>
            <span>Time (Dhaka)</span>
            <input
              className="input"
              type="time"
              value={form.timeHHmm}
              onChange={(event) => setForm((prev) => ({ ...prev, timeHHmm: event.target.value }))}
              required
            />
          </label>
          <label className="col-3 grid" style={{ gap: 6 }}>
            <span>Template Name</span>
            <input
              className="input"
              value={form.templateName}
              onChange={(event) => setForm((prev) => ({ ...prev, templateName: event.target.value }))}
              required
            />
          </label>
          <label className="col-3 grid" style={{ gap: 6 }}>
            <span>Language Code</span>
            <input
              className="input"
              value={form.languageCode}
              onChange={(event) => setForm((prev) => ({ ...prev, languageCode: event.target.value }))}
              required
            />
          </label>
          <label className="col-12 grid" style={{ gap: 6 }}>
            <span>Message Body ({`{body}`})</span>
            <textarea
              value={form.bodyText}
              onChange={(event) => setForm((prev) => ({ ...prev, bodyText: event.target.value }))}
              placeholder="Type the schedule message body"
              style={{ minHeight: 120 }}
              required
            />
          </label>
          <label className="col-3 grid" style={{ gap: 6 }}>
            <span>Report Slot Key (Optional)</span>
            <input
              className="input"
              value={form.reportSlotKey}
              onChange={(event) => setForm((prev) => ({ ...prev, reportSlotKey: event.target.value }))}
              placeholder="ex: afternoon"
              list="report-slot-suggestions"
            />
            <datalist id="report-slot-suggestions">
              {slotOptions.map((item) => (
                <option key={item.value} value={item.value} />
              ))}
            </datalist>
          </label>
          <label className="col-3 grid" style={{ gap: 6 }}>
            <span>Legacy Slot (Optional)</span>
            <select
              value={form.legacySlotKey}
              onChange={(event) => setForm((prev) => ({ ...prev, legacySlotKey: event.target.value as "" | ScheduleSlot }))}
            >
              <option value="">No legacy mapping</option>
              {slotOptions.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
          <label className="col-2 grid" style={{ gap: 6 }}>
            <span>Report Weight</span>
            <input
              className="input"
              type="number"
              min={0}
              max={100}
              step={0.25}
              value={form.reportWeight}
              onChange={(event) => setForm((prev) => ({ ...prev, reportWeight: event.target.value }))}
            />
          </label>
          <div className="col-4 inline" style={{ alignItems: "end", gap: 14 }}>
            <label className="inline">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) => setForm((prev) => ({ ...prev, isActive: event.target.checked }))}
              />
              Active
            </label>
            <label className="inline">
              <input
                type="checkbox"
                checked={form.reportMandatory}
                onChange={(event) => setForm((prev) => ({ ...prev, reportMandatory: event.target.checked }))}
              />
              Mandatory in report
            </label>
            <label className="inline">
              <input
                type="checkbox"
                checked={form.reportCritical}
                onChange={(event) => setForm((prev) => ({ ...prev, reportCritical: event.target.checked }))}
              />
              Critical in report
            </label>
          </div>
        </div>
        <div className="inline">
          <button type="submit" disabled={saving}>{saving ? "Saving..." : "Create Schedule"}</button>
          <button type="button" className="ghost" onClick={resetCreateForm} disabled={saving}>Reset</button>
        </div>
      </form>

      <article className="card grid" style={{ gap: 10 }}>
        <div className="inline" style={{ justifyContent: "space-between" }}>
          <h2>Existing Schedules</h2>
          <span className="muted">{schedules.length} total</span>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ minWidth: 180 }}>Label</th>
                <th style={{ minWidth: 140 }}>Time (Dhaka)</th>
                <th style={{ minWidth: 90 }}>Active</th>
                <th style={{ minWidth: 130 }}>Report Slot</th>
                <th style={{ minWidth: 140 }}>Report Policy</th>
                <th style={{ minWidth: 130 }}>Template</th>
                <th style={{ minWidth: 320 }}>Body</th>
                <th style={{ minWidth: 240 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {schedules.length ? schedules.map((item) => {
                const isEditing = editingId === item.id;
                return (
                  <tr key={item.id}>
                    <td>
                      {isEditing ? (
                        <input
                          className="input"
                          value={editForm.label}
                          onChange={(event) => setEditForm((prev) => ({ ...prev, label: event.target.value }))}
                        />
                      ) : item.label}
                    </td>
                    <td>
                      {isEditing ? (
                        <input
                          className="input"
                          type="time"
                          value={editForm.timeHHmm}
                          onChange={(event) => setEditForm((prev) => ({ ...prev, timeHHmm: event.target.value }))}
                        />
                      ) : `${item.timeHHmm} (${timeLabel(item.timeHHmm)})`}
                    </td>
                    <td>{isEditing ? (editForm.isActive ? "Yes" : "No") : (item.isActive ? "Yes" : "No")}</td>
                    <td>
                      {isEditing ? (
                        <input
                          className="input"
                          value={editForm.reportSlotKey}
                          onChange={(event) => setEditForm((prev) => ({ ...prev, reportSlotKey: event.target.value }))}
                          placeholder="ex: afternoon"
                          list="report-slot-suggestions"
                        />
                      ) : (item.reportSlotKey ?? "-")}
                    </td>
                    <td>
                      {isEditing ? (
                        <div className="grid" style={{ gap: 6 }}>
                          <label className="inline">
                            <input
                              type="checkbox"
                              checked={editForm.reportMandatory}
                              onChange={(event) => setEditForm((prev) => ({ ...prev, reportMandatory: event.target.checked }))}
                            />
                            Mandatory
                          </label>
                          <label className="inline">
                            <input
                              type="checkbox"
                              checked={editForm.reportCritical}
                              onChange={(event) => setEditForm((prev) => ({ ...prev, reportCritical: event.target.checked }))}
                            />
                            Critical
                          </label>
                          <label className="grid" style={{ gap: 4 }}>
                            <span>Weight</span>
                            <input
                              className="input"
                              type="number"
                              min={0}
                              max={100}
                              step={0.25}
                              value={editForm.reportWeight}
                              onChange={(event) => setEditForm((prev) => ({ ...prev, reportWeight: event.target.value }))}
                            />
                          </label>
                        </div>
                      ) : (
                        item.reportSlotKey
                          ? `${item.reportMandatory ? "Mandatory" : "Optional"}${item.reportCritical ? " | Critical" : ""} | Weight ${item.reportWeight}`
                          : "-"
                      )}
                    </td>
                    <td>
                      {isEditing ? (
                        <div className="grid" style={{ gap: 6 }}>
                          <input
                            className="input"
                            value={editForm.templateName}
                            onChange={(event) => setEditForm((prev) => ({ ...prev, templateName: event.target.value }))}
                          />
                          <input
                            className="input"
                            value={editForm.languageCode}
                            onChange={(event) => setEditForm((prev) => ({ ...prev, languageCode: event.target.value }))}
                          />
                        </div>
                      ) : `${item.templateName} (${item.languageCode})`}
                    </td>
                    <td>
                      {isEditing ? (
                        <textarea
                          value={editForm.bodyText}
                          onChange={(event) => setEditForm((prev) => ({ ...prev, bodyText: event.target.value }))}
                          style={{ minHeight: 96 }}
                        />
                      ) : item.bodyText}
                    </td>
                    <td>
                      {isEditing ? (
                        <div className="inline">
                          <button type="button" onClick={() => void onSaveEdit(item.id)} disabled={saving}>
                            {saving ? "Saving..." : "Save"}
                          </button>
                          <button type="button" className="ghost" onClick={() => setEditingId("")} disabled={saving}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="inline">
                          <button type="button" className="ghost" onClick={() => beginEdit(item)} disabled={saving}>
                            Edit
                          </button>
                          <button type="button" className="ghost" onClick={() => void onToggleActive(item)} disabled={saving}>
                            {item.isActive ? "Deactivate" : "Activate"}
                          </button>
                          <button type="button" className="danger" onClick={() => void onDelete(item)} disabled={saving}>
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={8}>No schedule entries found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}
