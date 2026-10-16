import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Figtree, Noto_Sans_Hebrew } from "next/font/google";
import "./globals.css";

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: "variable",
  axes: ["opsz"],
  variable: "--font-bricolage",
  display: "swap",
});
const figtree = Figtree({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-figtree", display: "swap" });
const hebrew = Noto_Sans_Hebrew({ subsets: ["hebrew"], weight: ["400", "600"], variable: "--font-hebrew", display: "swap" });

export const metadata: Metadata = {
  title: { default: "FFCC", template: "%s · FFCC" },
  description: "Family Financial Control Centre",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#EDE8DF",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={`${bricolage.variable} ${figtree.variable} ${hebrew.variable}`}>
      <body>{children}</body>
    </html>
  );
}
