import type { Metadata } from "next";
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
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
