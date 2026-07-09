import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LOI Vault",
  description: "Upload LOIs, extract deal terms, run commission math, and track counters.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Loaded as a stylesheet (not next/font) so builds never depend on
            fetching Google Fonts at compile time; falls back to system fonts. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:wght@400;500;600&family=Inter:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans antialiased min-h-screen">{children}</body>
    </html>
  );
}
