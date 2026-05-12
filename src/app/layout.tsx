import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Champions Family Ops",
  description: "WhatsApp operations platform for tracking, reporting, and broadcast.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
