import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Epoch — Cardano Staking Dashboard",
  description:
    "Cardano Staking Dashboard mit Reward-Historie, Live-Epoch-Countdown und EUR-Steuerexport.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
