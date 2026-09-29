import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Oasis Park · Reserva tu palapa",
  description: "Un lugar para compartir. Reserva una de las seis palapas, la cancha o el campo de fútbol de Oasis Park.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <head>
        <link rel="preload" href="/fonts/montserrat-latin.woff2" as="font" type="font/woff2" crossOrigin="" />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
