import type { Metadata, Viewport } from "next";
import "@fontsource-variable/manrope";
import "./globals.css";
import { PwaRegister } from "@/components/pwa-register";
import { SessionGuard } from "@/components/session-guard";

export const metadata: Metadata = {
  title: "DOPS | Plastic & Reconstructive Surgery",
  description: "Clinical and academic workflow management for the Department of Plastic & Reconstructive Surgery, NSCB Medical College, Jabalpur.",
  icons: {
    icon: [{ url: "/brand/favicon-64.png", sizes: "64x64", type: "image/png" }],
    shortcut: "/brand/favicon-64.png",
    apple: "/brand/apple-touch-icon.png",
  },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = { themeColor: "#0c1b33" };

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
