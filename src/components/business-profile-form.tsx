"use client";

import { useRef, useState } from "react";
import type { BusinessProfile } from "@/lib/whatsapp";

type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

export function BusinessProfileForm({
  initialProfile,
  loadError,
  appIdConfigured,
}: {
  initialProfile: BusinessProfile | null;
  loadError: string | null;
  appIdConfigured: boolean;
}) {
  const [profile, setProfile] = useState<BusinessProfile | null>(initialProfile);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function onPhotoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setPreview(file ? URL.createObjectURL(file) : null);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus({ kind: "saving" });

    try {
      const response = await fetch("/api/settings/business-profile", {
        method: "POST",
        body: new FormData(event.currentTarget),
      });
      const json = (await response.json().catch(() => ({}))) as {
        profile?: BusinessProfile;
        error?: string;
      };

      if (!response.ok) {
        setStatus({ kind: "error", message: json.error ?? "Update failed" });
        return;
      }

      if (json.profile) setProfile(json.profile);
      setPreview(null);
      if (fileRef.current) fileRef.current.value = "";
      setStatus({ kind: "ok", message: "Business profile updated. Recipients will see the changes shortly." });
    } catch {
      setStatus({ kind: "error", message: "Network error — please try again." });
    }
  }

  const currentPhoto = preview ?? profile?.profile_picture_url ?? null;

  return (
    <form className="grid" style={{ gap: 16 }} onSubmit={onSubmit}>
      {loadError ? (
        <p className="login-error">Could not load current profile: {loadError}</p>
      ) : null}

      {!appIdConfigured ? (
        <p className="login-error">
          WHATSAPP_APP_ID is not set — text fields below will save, but the profile
          photo upload will fail until it is configured in the environment.
        </p>
      ) : null}

      <div className="inline" style={{ gap: 16, alignItems: "center" }}>
        <span className="avatar" style={{ width: 72, height: 72, overflow: "hidden" }}>
          {currentPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={currentPhoto}
              alt="Business profile"
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <span aria-hidden="true">CF</span>
          )}
        </span>
        <label className="grid" style={{ gap: 6 }}>
          <span>Profile photo (JPG/PNG, square, max 5MB)</span>
          <input ref={fileRef} type="file" name="photo" accept="image/jpeg,image/png" onChange={onPhotoChange} />
        </label>
      </div>

      <label className="grid" style={{ gap: 6 }}>
        <span>About (short status line under the name)</span>
        <input className="input" type="text" name="about" defaultValue={profile?.about ?? ""} maxLength={139} />
      </label>

      <label className="grid" style={{ gap: 6 }}>
        <span>Description</span>
        <textarea className="input" name="description" rows={3} defaultValue={profile?.description ?? ""} maxLength={512} />
      </label>

      <label className="grid" style={{ gap: 6 }}>
        <span>Email</span>
        <input className="input" type="email" name="email" defaultValue={profile?.email ?? ""} />
      </label>

      <label className="grid" style={{ gap: 6 }}>
        <span>Address</span>
        <input className="input" type="text" name="address" defaultValue={profile?.address ?? ""} maxLength={256} />
      </label>

      <label className="grid" style={{ gap: 6 }}>
        <span>Websites (one per line, max 2)</span>
        <textarea
          className="input"
          name="websites"
          rows={2}
          defaultValue={(profile?.websites ?? []).join("\n")}
        />
      </label>

      <div className="inline" style={{ gap: 12, alignItems: "center" }}>
        <button type="submit" disabled={status.kind === "saving"}>
          {status.kind === "saving" ? "Saving…" : "Save profile"}
        </button>
        {status.kind === "ok" ? <span className="pill pill-ok">{status.message}</span> : null}
        {status.kind === "error" ? <span className="login-error" style={{ margin: 0 }}>{status.message}</span> : null}
      </div>
    </form>
  );
}
