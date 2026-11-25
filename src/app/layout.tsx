import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pulseframe — Music Video Studio",
  description: "Create music videos in your browser.",
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
