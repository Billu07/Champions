"use client";

import { FormEvent, useMemo, useState } from "react";

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
  const [selectedTags, setSelectedTags] = useState<string[]>(["sales_field"]);
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>("");

  async function load() {
    const [employeeRes, tagRes] = await Promise.all([
      fetch("/api/employees", { cache: "no-store" }),
      fetch("/api/tags", { cache: "no-store" }),
    ]);

    const employeeJson = await employeeRes.json();
    const tagJson = await tagRes.json();

    setEmployees(employeeJson.employees ?? []);
    setTags(tagJson.tags ?? []);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");

    const payload = {
      ...form,
      aliases: form.aliases
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      tagKeys: selectedTags,
    };

    const res = await fetch("/api/employees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const json = await res.json();

    if (!res.ok) {
      setMessage(json.error ?? "Failed to save employee");
      setSaving(false);
      return;
    }

    setMessage("Employee saved.");
    setForm(defaultForm);
    setSelectedTags(["sales_field"]);
    await load();
    setSaving(false);
  }

  const trackedCount = useMemo(
    () => employees.filter((item) => item.tracking_enabled && item.is_active).length,
    [employees],
  );

  return (
    <section className="grid" style={{ gap: 16 }}>
      <div className="grid cards">
        <article className="card">
          <h2>Total Active</h2>
          <p>{employees.filter((item) => item.is_active).length}</p>
        </article>
        <article className="card">
          <h2>Tracking Enabled</h2>
          <p>{trackedCount}</p>
        </article>
        <article className="card">
          <h2>Tag Count</h2>
          <p>{tags.length}</p>
        </article>
      </div>

      <form className="card grid" onSubmit={onSubmit}>
        <h2>Add Employee</h2>
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

        <div className="grid" style={{ gap: 8 }}>
          <strong>Tags</strong>
          <div className="inline">
            {tags.map((tag) => (
              <label key={tag.key} className="inline pill">
                <input
                  type="checkbox"
                  checked={selectedTags.includes(tag.key)}
                  onChange={(event) => {
                    setSelectedTags((prev) =>
                      event.target.checked
                        ? Array.from(new Set([...prev, tag.key]))
                        : prev.filter((item) => item !== tag.key),
                    );
                  }}
                />
                {tag.label}
              </label>
            ))}
          </div>
        </div>

        <div className="inline">
          <button disabled={saving} type="submit">
            {saving ? "Saving..." : "Save Employee"}
          </button>
          {message ? <span className="muted">{message}</span> : null}
        </div>
      </form>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>WhatsApp</th>
              <th>Designation</th>
              <th>Department</th>
              <th>Tracking</th>
              <th>Tags</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((employee) => (
              <tr key={employee.id}>
                <td>{employee.full_name}</td>
                <td>{employee.whatsapp_e164}</td>
                <td>{employee.designation || "-"}</td>
                <td>{employee.department || "-"}</td>
                <td>{employee.tracking_enabled ? "Yes" : "No"}</td>
                <td>
                  {employee.tags.length
                    ? employee.tags.map((tag) => tag.label).join(", ")
                    : "-"}
                </td>
                <td>{employee.is_active ? employee.status : "Inactive"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
