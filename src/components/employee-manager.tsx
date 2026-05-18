"use client";

import { FormEvent, useMemo, useRef, useState } from "react";

type Tag = {
  id?: string;
  key: string;
  label: string;
};

type Employee = {
  id: string;
  full_name: string;
  designation: string | null;
  department: string | null;
  branch: string | null;
  whatsapp_e164: string;
  tracking_enabled: boolean;
  is_active: boolean;
  status: string;
  aliases: string[];
  notes: string | null;
  tags: Tag[];
};

type EmployeeManagerProps = {
  initialEmployees: Employee[];
  initialTags: Tag[];
};

const defaultForm = {
  id: "",
  fullName: "",
  designation: "",
  department: "",
  branch: "",
  whatsappNumber: "",
  trackingEnabled: false,
  isActive: true,
  status: "Active",
  aliases: "",
  notes: "",
};

export function EmployeeManager({ initialEmployees, initialTags }: EmployeeManagerProps) {
  const [employees, setEmployees] = useState<Employee[]>(initialEmployees);
  const [tags, setTags] = useState<Tag[]>(initialTags);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const [bulkTag, setBulkTag] = useState<string>("sales_field");
  const [form, setForm] = useState(defaultForm);
  const [editorOpen, setEditorOpen] = useState(false);
  const [filterTag, setFilterTag] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "inactive">("all");
  const [filterTracking, setFilterTracking] = useState<"all" | "tracked" | "untracked">("all");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [newTagKey, setNewTagKey] = useState("");
  const [newTagLabel, setNewTagLabel] = useState("");
  const editorRef = useRef<HTMLFormElement | null>(null);

  const editing = Boolean(form.id);
  const effectiveBulkTag = bulkTag === "all" || tags.some((tag) => tag.key === bulkTag)
    ? bulkTag
    : (tags[0]?.key ?? "all");

  function parseTagSelection(select: HTMLSelectElement): string[] {
    return Array.from(select.selectedOptions).map((item) => item.value);
  }

  function dedupeIds(ids: string[]): string[] {
    return Array.from(new Set(ids));
  }

  function openEditor(mode: "create" | "edit"): void {
    setEditorOpen(true);
    if (mode === "create") {
      resetForm(false);
    }
    setTimeout(() => {
      editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }

  async function load() {
    setLoading(true);
    const [employeeRes, tagRes] = await Promise.all([
      fetch("/api/employees", { cache: "no-store" }),
      fetch("/api/tags", { cache: "no-store" }),
    ]);

    const employeeJson = await employeeRes.json().catch(() => ({}));
    const tagJson = await tagRes.json().catch(() => ({}));

    if (!employeeRes.ok || !tagRes.ok) {
      setMessage(
        (employeeJson as { error?: string }).error
          ?? (tagJson as { error?: string }).error
          ?? "Failed to refresh employee data",
      );
      setLoading(false);
      return;
    }

    const latestEmployees = (employeeJson as { employees?: Employee[] }).employees ?? [];
    setEmployees(latestEmployees);
    setSelectedEmployeeIds((prev) => prev.filter((id) => latestEmployees.some((employee) => employee.id === id)));
    setTags((tagJson as { tags?: Tag[] }).tags ?? []);
    setLoading(false);
  }

  function resetForm(closeEditor = true) {
    setForm(defaultForm);
    setSelectedTags([]);
    if (closeEditor) {
      setEditorOpen(false);
    }
  }

  function beginEdit(employee: Employee) {
    setForm({
      id: employee.id,
      fullName: employee.full_name,
      designation: employee.designation ?? "",
      department: employee.department ?? "",
      branch: employee.branch ?? "",
      whatsappNumber: employee.whatsapp_e164,
      trackingEnabled: employee.tracking_enabled,
      isActive: employee.is_active,
      status: employee.status || "Active",
      aliases: employee.aliases.join(", "),
      notes: employee.notes ?? "",
    });
    setSelectedTags(employee.tags.map((tag) => tag.key));
    setMessage(`Editing ${employee.full_name}`);
    openEditor("edit");
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");

    const payload = {
      id: form.id || undefined,
      fullName: form.fullName,
      designation: form.designation,
      department: form.department,
      branch: form.branch,
      whatsappNumber: form.whatsappNumber,
      trackingEnabled: form.trackingEnabled,
      isActive: form.isActive,
      status: form.status,
      aliases: form.aliases
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      notes: form.notes,
      tagKeys: selectedTags,
    };

    const res = await fetch("/api/employees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage((json as { error?: string }).error ?? "Failed to save employee");
      setSaving(false);
      return;
    }

    setMessage(editing ? "Member updated successfully." : "Member created successfully.");
    await load();
    resetForm();
    setSaving(false);
  }

  async function onDelete(employee: Employee) {
    const confirmed = window.confirm(`Delete ${employee.full_name}? This cannot be undone.`);
    if (!confirmed) return;

    const res = await fetch(`/api/employees?id=${employee.id}`, { method: "DELETE" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage((json as { error?: string }).error ?? "Failed to delete employee");
      return;
    }

    setMessage(`${employee.full_name} removed.`);
    if (form.id === employee.id) resetForm();
    await load();
  }

  async function onCreateTag() {
    if (!newTagKey.trim() || !newTagLabel.trim()) {
      setMessage("Tag key and label are required.");
      return;
    }

    const res = await fetch("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: newTagKey.trim().toLowerCase(),
        label: newTagLabel.trim(),
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage((json as { error?: string }).error ?? "Failed to create tag");
      return;
    }

    setNewTagKey("");
    setNewTagLabel("");
    setMessage("Tag saved.");
    await load();
  }

  function toggleEmployeeSelection(employeeId: string, checked: boolean): void {
    setSelectedEmployeeIds((prev) =>
      checked ? dedupeIds([...prev, employeeId]) : prev.filter((id) => id !== employeeId),
    );
  }

  function selectFilteredEmployees(): void {
    setSelectedEmployeeIds(dedupeIds(filteredEmployees.map((employee) => employee.id)));
  }

  function selectEmployeesByTag(tagKey: string): void {
    if (tagKey === "all") {
      setSelectedEmployeeIds(dedupeIds(employees.map((employee) => employee.id)));
      return;
    }
    setSelectedEmployeeIds(
      dedupeIds(
        employees
          .filter((employee) => employee.tags.some((tag) => tag.key === tagKey))
          .map((employee) => employee.id),
      ),
    );
  }

  function clearSelectedEmployees(): void {
    setSelectedEmployeeIds([]);
  }

  async function onBulkTrackingUpdate(trackingEnabled: boolean) {
    const ids = dedupeIds(selectedEmployeeIds);
    if (ids.length === 0) {
      setMessage("Select at least one member for bulk tracking update.");
      return;
    }

    setBulkSaving(true);
    setMessage("");

    const res = await fetch("/api/employees", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeIds: ids,
        trackingEnabled,
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage((json as { error?: string }).error ?? "Failed to update tracking settings.");
      setBulkSaving(false);
      return;
    }

    setMessage(`Tracking ${trackingEnabled ? "enabled" : "disabled"} for ${ids.length} member(s).`);
    await load();
    setSelectedEmployeeIds([]);
    setBulkSaving(false);
  }

  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();

    return employees.filter((employee) => {
      if (filterStatus === "active" && !employee.is_active) return false;
      if (filterStatus === "inactive" && employee.is_active) return false;
      if (filterTracking === "tracked" && !employee.tracking_enabled) return false;
      if (filterTracking === "untracked" && employee.tracking_enabled) return false;

      if (filterTag !== "all" && !employee.tags.some((tag) => tag.key === filterTag)) {
        return false;
      }

      if (!q) return true;

      const haystack = [
        employee.full_name,
        employee.whatsapp_e164,
        employee.designation ?? "",
        employee.department ?? "",
        employee.branch ?? "",
        employee.tags.map((tag) => tag.label).join(" "),
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [employees, filterStatus, filterTag, filterTracking, search]);

  const stats = useMemo(() => {
    const active = employees.filter((employee) => employee.is_active).length;
    const tracked = employees.filter((employee) => employee.is_active && employee.tracking_enabled).length;
    const drivers = employees.filter((employee) => employee.tags.some((tag) => tag.key === "drivers") && employee.is_active).length;

    return {
      total: employees.length,
      active,
      tracked,
      drivers,
    };
  }, [employees]);

  return (
    <section className="grid" style={{ gap: 16 }}>
      <div className="kpi-grid">
        <article className="card kpi-card">
          <p className="kpi-label">Total Members</p>
          <p className="kpi-value">{stats.total}</p>
        </article>
        <article className="card kpi-card">
          <p className="kpi-label">Active</p>
          <p className="kpi-value">{stats.active}</p>
        </article>
        <article className="card kpi-card">
          <p className="kpi-label">Tracking Enabled</p>
          <p className="kpi-value">{stats.tracked}</p>
        </article>
        <article className="card kpi-card">
          <p className="kpi-label">Drivers</p>
          <p className="kpi-value">{stats.drivers}</p>
        </article>
      </div>

      <article className="card grid" style={{ gap: 10 }}>
        <div className="inline" style={{ justifyContent: "space-between" }}>
          <h2>Member Actions</h2>
          <div className="inline">
            <button type="button" onClick={() => openEditor("create")}>
              Add Member
            </button>
            <button className="ghost" type="button" onClick={() => void load()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        {message ? <p className="muted">{message}</p> : null}

        <div className="row">
          <label className="col-4 grid" style={{ gap: 6 }}>
            <span>Bulk Tag</span>
            <select value={effectiveBulkTag} onChange={(event) => setBulkTag(event.target.value)}>
              <option value="all">All Members</option>
              {tags.map((tag) => (
                <option key={tag.key} value={tag.key}>
                  {tag.label}
                </option>
              ))}
            </select>
          </label>

          <div className="col-8 grid" style={{ gap: 6 }}>
            <span>Bulk Tracking Update</span>
            <div className="inline" style={{ flexWrap: "wrap" }}>
              <button type="button" className="ghost" onClick={() => selectEmployeesByTag(effectiveBulkTag)} disabled={bulkSaving}>
                Select Tag Members
              </button>
              <button type="button" className="ghost" onClick={() => selectFilteredEmployees()} disabled={bulkSaving}>
                Select Filtered
              </button>
              <button type="button" className="ghost" onClick={() => clearSelectedEmployees()} disabled={bulkSaving}>
                Clear Selection
              </button>
              <button type="button" onClick={() => void onBulkTrackingUpdate(true)} disabled={bulkSaving}>
                {bulkSaving ? "Updating..." : "Enable Tracking"}
              </button>
              <button type="button" className="danger" onClick={() => void onBulkTrackingUpdate(false)} disabled={bulkSaving}>
                {bulkSaving ? "Updating..." : "Disable Tracking"}
              </button>
              <span className="muted">Selected: {selectedEmployeeIds.length}</span>
            </div>
          </div>
        </div>
      </article>

      {editorOpen ? (
        <form className="card grid" onSubmit={onSubmit} style={{ gap: 12 }} ref={editorRef}>
          <div className="inline" style={{ justifyContent: "space-between" }}>
            <h2>{editing ? `Edit Member: ${form.fullName}` : "Add Member"}</h2>
            <button className="ghost" type="button" onClick={() => resetForm()}>
              Close
            </button>
          </div>

          <div className="row">
            <label className="col-6 grid" style={{ gap: 6 }}>
              <span>Full Name</span>
              <input
                className="input"
                value={form.fullName}
                onChange={(event) => setForm((prev) => ({ ...prev, fullName: event.target.value }))}
                required
              />
            </label>

            <label className="col-6 grid" style={{ gap: 6 }}>
              <span>WhatsApp Number</span>
              <input
                className="input"
                value={form.whatsappNumber}
                onChange={(event) => setForm((prev) => ({ ...prev, whatsappNumber: event.target.value }))}
                required
              />
            </label>

            <label className="col-4 grid" style={{ gap: 6 }}>
              <span>Designation</span>
              <input
                className="input"
                value={form.designation}
                onChange={(event) => setForm((prev) => ({ ...prev, designation: event.target.value }))}
              />
            </label>

            <label className="col-4 grid" style={{ gap: 6 }}>
              <span>Department</span>
              <input
                className="input"
                value={form.department}
                onChange={(event) => setForm((prev) => ({ ...prev, department: event.target.value }))}
              />
            </label>

            <label className="col-4 grid" style={{ gap: 6 }}>
              <span>Branch</span>
              <input
                className="input"
                value={form.branch}
                onChange={(event) => setForm((prev) => ({ ...prev, branch: event.target.value }))}
              />
            </label>

            <label className="col-6 grid" style={{ gap: 6 }}>
              <span>Aliases (comma separated)</span>
              <input
                className="input"
                value={form.aliases}
                onChange={(event) => setForm((prev) => ({ ...prev, aliases: event.target.value }))}
              />
            </label>

            <label className="col-6 grid" style={{ gap: 6 }}>
              <span>Status</span>
              <input
                className="input"
                value={form.status}
                onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}
              />
            </label>

            <label className="col-12 grid" style={{ gap: 6 }}>
              <span>Notes</span>
              <textarea
                value={form.notes}
                onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
              />
            </label>
          </div>

          <div className="inline">
            <label className="inline">
              <input
                type="checkbox"
                checked={form.trackingEnabled}
                onChange={(event) => setForm((prev) => ({ ...prev, trackingEnabled: event.target.checked }))}
              />
              Tracking Enabled
            </label>
            <label className="inline">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) => setForm((prev) => ({ ...prev, isActive: event.target.checked }))}
              />
              Active
            </label>
          </div>

          <label className="grid" style={{ gap: 6 }}>
            <span>Tags (multi-select)</span>
            <select
              multiple
              size={Math.max(4, Math.min(7, tags.length))}
              value={selectedTags}
              onChange={(event) => setSelectedTags(parseTagSelection(event.currentTarget))}
            >
              {tags.map((tag) => (
                <option key={tag.key} value={tag.key}>
                  {tag.label}
                </option>
              ))}
            </select>
          </label>

          <div className="inline">
            <button disabled={saving} type="submit">
              {saving ? "Saving..." : editing ? "Update Member" : "Create Member"}
            </button>
            {editing ? (
              <button className="ghost" type="button" onClick={() => resetForm()}>
                Cancel Edit
              </button>
            ) : null}
          </div>
        </form>
      ) : null}

      <article className="card grid" style={{ gap: 10 }}>
        <h2>Create Tag</h2>
        <div className="row">
          <label className="col-6 grid" style={{ gap: 6 }}>
            <span>Tag Key</span>
            <input
              className="input"
              value={newTagKey}
              onChange={(event) => setNewTagKey(event.target.value)}
              placeholder="example: customers"
            />
          </label>
          <label className="col-6 grid" style={{ gap: 6 }}>
            <span>Label</span>
            <input
              className="input"
              value={newTagLabel}
              onChange={(event) => setNewTagLabel(event.target.value)}
              placeholder="Customers"
            />
          </label>
        </div>
        <div className="inline">
          <button type="button" onClick={() => void onCreateTag()}>
            Save Tag
          </button>
        </div>
      </article>

      <article className="card grid" style={{ gap: 10 }}>
        <div className="inline" style={{ justifyContent: "space-between" }}>
          <h2>Directory</h2>
          <span className="muted">Showing {filteredEmployees.length} of {employees.length}</span>
        </div>

        <div className="row">
          <label className="col-3 grid" style={{ gap: 6 }}>
            <span>Search</span>
            <input
              className="input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name / number / department"
            />
          </label>

          <label className="col-3 grid" style={{ gap: 6 }}>
            <span>Tag Filter</span>
            <select value={filterTag} onChange={(event) => setFilterTag(event.target.value)}>
              <option value="all">All tags</option>
              {tags.map((tag) => (
                <option key={tag.key} value={tag.key}>
                  {tag.label}
                </option>
              ))}
            </select>
          </label>

          <label className="col-3 grid" style={{ gap: 6 }}>
            <span>Status Filter</span>
            <select
              value={filterStatus}
              onChange={(event) => setFilterStatus(event.target.value as "all" | "active" | "inactive")}
            >
              <option value="all">All</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </select>
          </label>

          <label className="col-3 grid" style={{ gap: 6 }}>
            <span>Tracking Filter</span>
            <select
              value={filterTracking}
              onChange={(event) => setFilterTracking(event.target.value as "all" | "tracked" | "untracked")}
            >
              <option value="all">All</option>
              <option value="tracked">Tracking enabled</option>
              <option value="untracked">Tracking disabled</option>
            </select>
          </label>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 72 }}>Select</th>
                <th>Name</th>
                <th>WhatsApp</th>
                <th>Designation</th>
                <th>Department</th>
                <th>Tracking</th>
                <th>Tags</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredEmployees.length ? filteredEmployees.map((employee) => (
                <tr key={employee.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedEmployeeIds.includes(employee.id)}
                      onChange={(event) => toggleEmployeeSelection(employee.id, event.target.checked)}
                    />
                  </td>
                  <td>{employee.full_name}</td>
                  <td>{employee.whatsapp_e164}</td>
                  <td>{employee.designation || "-"}</td>
                  <td>{employee.department || "-"}</td>
                  <td>{employee.tracking_enabled ? "Yes" : "No"}</td>
                  <td>{employee.tags.length ? employee.tags.map((tag) => tag.label).join(", ") : "-"}</td>
                  <td>{employee.is_active ? employee.status : "Inactive"}</td>
                  <td>
                    <div className="inline">
                      <button className="ghost" type="button" onClick={() => beginEdit(employee)}>
                        Edit
                      </button>
                      <button className="danger" type="button" onClick={() => void onDelete(employee)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={9}>No employees match current filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}
