import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Partnership Scout",
  description:
    "Find newly launched tools worth a partnership call, from Product Hunt's last 7 days.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
