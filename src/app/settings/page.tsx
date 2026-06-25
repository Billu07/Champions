import { redirect } from "next/navigation";
import { isLoggedIn } from "@/lib/auth";
import { env } from "@/lib/config";
import { AdminNav } from "@/components/admin-nav";
import { BusinessProfileForm } from "@/components/business-profile-form";
import { getBusinessProfile, type BusinessProfile } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  if (!(await isLoggedIn())) {
    redirect("/login");
  }

  let profile: BusinessProfile | null = null;
  let loadError: string | null = null;
  try {
    profile = await getBusinessProfile();
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Unknown error";
  }

  return (
    <main className="page">
      <AdminNav />
      <h1>Business Profile</h1>
      <p>
        This is the photo and info every recipient sees on WhatsApp when Champions Family
        messages them. Updates apply to the business phone number, not individual senders.
      </p>

      <section className="card" style={{ marginTop: 16, maxWidth: 640 }}>
        <BusinessProfileForm
          initialProfile={profile}
          loadError={loadError}
          appIdConfigured={Boolean(env.WHATSAPP_APP_ID)}
        />
      </section>
    </main>
  );
}
