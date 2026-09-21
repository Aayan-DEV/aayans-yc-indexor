import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

export const metadata: Metadata = {
  title: "Icon Recall",
  description: "Describe an image the way you remember it.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      {/* Browser extensions write their own attributes onto <body> before React loads (ColorZilla adds cz-shortcut-listen).
          That is not a bug in the page, so the mismatch warning is switched off for this one element only. */}
      <body className="font-sans antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
