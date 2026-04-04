import type { Metadata } from "next";
import Script from "next/script";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Haia — FX Trading Performance Analytics",
  description:
    "Connect your MetaTrader accounts and analyze your trading performance with rich analytics, PNL calendars, and shareable flex cards.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-bg-primary text-text-primary font-sans">
        <Script
          id="google-fonts"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              var link = document.createElement('link');
              link.rel = 'stylesheet';
              link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap';
              document.head.appendChild(link);
            `,
          }}
        />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
