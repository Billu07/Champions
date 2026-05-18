import { redirect } from "next/navigation";
import Image from "next/image";
import { isLoggedIn } from "@/lib/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await isLoggedIn()) {
    redirect("/dashboard");
  }

  const params = await searchParams;

  return (
    <main className="page login-page">
      <article className="card login-card">
        <div className="login-brand">
          <Image
            src="/brand/logo-c.png"
            alt="Champions Family"
            width={454}
            height={180}
            priority
            className="login-brand-logo"
          />
          <span className="login-brand-pill">Secure Leadership Access</span>
        </div>
        <h1>CEO Login</h1>
        <p>Sign in with the admin username and password from Vercel environment variables.</p>

        <form method="post" action="/api/auth/login" className="grid" style={{ gap: 12 }}>
          <label className="grid" style={{ gap: 6 }}>
            <span>Username</span>
            <input className="input" type="text" name="username" autoFocus required />
          </label>
          <label className="grid" style={{ gap: 6 }}>
            <span>Password</span>
            <input className="input" type="password" name="password" required />
          </label>
          <button type="submit">Sign In</button>
        </form>

        {params.error ? <p className="login-error">Invalid username or password.</p> : null}
      </article>
    </main>
  );
}
