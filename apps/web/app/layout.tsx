import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import { ReactQueryProvider } from "@/components/providers/react-query-provider";
import { PageTransition } from "@/components/providers/page-transition";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  style: ["normal", "italic"],
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["300", "400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Trailmap — Living Architecture Maps",
  description: "Auto-generated, always-current architecture maps for your codebase",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable}`}>
      <body>
        <ReactQueryProvider>
          <PageTransition>{children}</PageTransition>
        </ReactQueryProvider>
      </body>
    </html>
  );
}
