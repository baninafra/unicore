import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/shell/app-shell";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "UniCore",
  description: "Tus carreras, en un solo núcleo.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-AR" data-theme="dark" suppressHydrationWarning>
      <body className={`${outfit.variable} antialiased`}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
