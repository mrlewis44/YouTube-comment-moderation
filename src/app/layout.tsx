import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Comment Copilot",
  description:
    "YouTube comment triage and response drafting for The Educated HomeBuyer and Josh Lewis.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
