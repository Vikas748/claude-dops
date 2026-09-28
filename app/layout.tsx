import type { Metadata } from "next";
import "./globals.css";
import { PwaRegister } from "@/components/pwa-register";
import { SessionGuard } from "@/components/session-guard";

export const metadata: Metadata = {
  title: "DOPS | Plastic & Reconstructive Surgery",
  description: "Clinical and academic workflow management for the Department of Burn & Plastic Surgery.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased"><PwaRegister/><SessionGuard/>{children}</body>
    </html>
  );
}
