import { redirect } from "next/navigation";
import { isLoggedIn } from "@/lib/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await isLoggedIn()) {
    redirect("/employees");
  }

  const params = await searchParams;

  return (
    <main className="page" style={{ maxWidth: 460 }}>
      <h1>CEO Login</h1>
      <p>Enter the dashboard password configured in `CEO_PANEL_PASSWORD`.</p>

      <form method="post" action="/api/auth/login" className="card grid">
        <label className="grid" style={{ gap: 6 }}>
          <span>Password</span>
          <input className="input" type="password" name="password" autoFocus required />
        </label>
        <button type="submit">Sign In</button>
      </form>

      {params.error ? <p style={{ color: "#b91c1c" }}>Invalid password.</p> : null}
    </main>
  );
}
