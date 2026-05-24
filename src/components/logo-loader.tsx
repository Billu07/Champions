import Image from "next/image";

export function LogoLoader() {
  return (
    <main className="logo-loader-shell" role="status" aria-live="polite" aria-label="Loading">
      <div className="logo-loader-card">
        <Image
          src="/brand/logo-c.png"
          alt="Champions Family"
          width={300}
          height={92}
          className="logo-loader-image"
        />
        <div className="logo-loader-bar" aria-hidden="true">
          <span />
        </div>
      </div>
    </main>
  );
}
