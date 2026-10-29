import type { Metadata } from "next";
import "./globals.css";
import '@fontsource-variable/inter';
import './redesign.css';

export const metadata: Metadata = {
  title: "Codex Hub",
  description: "Проекты, задачи и результаты Codex на одной доске.",
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
    <html lang="ru">
      <body className="antialiased">{children}</body>
    </html>
  );
}
