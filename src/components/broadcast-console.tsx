"use client";

import { FormEvent, useMemo, useState } from "react";

type Employee = {
  id: string;
  full_name: string;
  whatsapp_e164: string;
  department: string | null;
  designation: string | null;
  is_active: boolean;
};

type Tag = {
  key: string;
  label: string;
};

type PreviewResponse = {
  recipients: Employee[];
  mentionMatches: Array<{ fullName: string; confidence: number; reason: string }>;
  unresolvedMentions: string[];
  enhancedMessage: string;
};

type BroadcastConsoleProps = {
  initialEmployees: Employee[];
  initialTags: Tag[];
};

export function BroadcastConsole({ initialEmployees, initialTags }: BroadcastConsoleProps) {
  const [employees] = useState<Employee[]>(initialEmployees);
  const [tags] = useState<Tag[]>(initialTags);
  const [message, setMessage] = useState("");
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const [selectedTagKeys, setSelectedTagKeys] = useState<string[]>([]);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [useEnhanced, setUseEnhanced] = useState(true);
  const [status, setStatus] = useState<string>("");

  const effectiveMessage = useMemo(() => {
    if (!preview) return message;
    return useEnhanced ? preview.enhancedMessage : message;
  }, [preview, useEnhanced, message]);

  async function onPreview(event: FormEvent) {
    event.preventDefault();
    setStatus("Generating preview...");

    const res = await fetch("/api/broadcasts/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        selectedEmployeeIds,
        selectedTagKeys,
      }),
    });

    const json = await res.json();

    if (!res.ok) {
      setStatus(json.error ?? "Preview failed");
      return;
    }

    setPreview(json);
    setStatus(`Preview ready for ${json.recipients.length} recipients.`);
  }

  async function onSend() {
    if (!preview) return;
    setStatus("Sending broadcast...");

    const res = await fetch("/api/broadcasts/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        originalMessage: message,
        finalMessage: effectiveMessage,
        recipientEmployeeIds: preview.recipients.map((item) => item.id),
        audienceType: "mixed",
      }),
    });

    const json = await res.json();

    if (!res.ok) {
      setStatus(json.error ?? "Broadcast failed");
      return;
    }

    setStatus(`Campaign ${json.campaignId}: sent=${json.sent}, failed=${json.failed}`);
  }

  return (
    <section className="grid" style={{ gap: 16 }}>
      <form className="card grid" onSubmit={onPreview}>
        <h2>CEO Broadcast Composer</h2>
        <p>
          Mention names naturally or with @ syntax. The system will auto-match recipients and show
          confirmation before send.
        </p>

        <label className="grid" style={{ gap: 6 }}>
          <span>Message</span>
          <textarea value={message} onChange={(event) => setMessage(event.target.value)} required />
        </label>

        <div className="grid">
          <strong>Tag Selection</strong>
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

        <div className="grid">
          <strong>Manual Recipient Selection</strong>
          <div className="inline">
            {employees.slice(0, 30).map((employee) => (
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

        <div className="inline">
          <button type="submit">Preview Recipients + AI Enhancement</button>
          <span className="muted">{status}</span>
        </div>
      </form>

      {preview ? (
        <article className="card grid" style={{ gap: 12 }}>
          <h2>Preview</h2>
          <p>Recipients: {preview.recipients.length}</p>

          <div>
            <strong>Mention Matches</strong>
            <ul>
              {preview.mentionMatches.length ? (
                preview.mentionMatches.map((match, index) => (
                  <li key={`${match.fullName}-${index}`}>
                    {match.fullName} ({Math.round(match.confidence * 100)}%)
                  </li>
                ))
              ) : (
                <li>No mention-based matches.</li>
              )}
            </ul>
          </div>

          {preview.unresolvedMentions.length ? (
            <div>
              <strong>Unresolved Mentions</strong>
              <p>{preview.unresolvedMentions.join(", ")}</p>
            </div>
          ) : null}

          <label className="inline">
            <input
              type="checkbox"
              checked={useEnhanced}
              onChange={(event) => setUseEnhanced(event.target.checked)}
            />
            Send AI-enhanced message
          </label>

          <div className="row">
            <div className="col-6">
              <h3 style={{ margin: "0 0 8px" }}>Original</h3>
              <pre>{message}</pre>
            </div>
            <div className="col-6">
              <h3 style={{ margin: "0 0 8px" }}>Enhanced</h3>
              <pre>{preview.enhancedMessage}</pre>
            </div>
          </div>

          <button onClick={onSend}>Send Broadcast</button>
        </article>
      ) : null}
    </section>
  );
}
