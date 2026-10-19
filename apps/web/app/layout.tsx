import type { Metadata } from "next";
import localFont from "next/font/local";
import { ReactQueryProvider } from "@/components/providers/react-query-provider";
import { PageTransition } from "@/components/providers/page-transition";
import "./globals.css";

const plexSans = localFont({
  variable: "--font-body",
  display: "swap",
  src: [
    { path: "./fonts/ibm-plex-sans-latin-400-normal.woff2", weight: "400" },
    { path: "./fonts/ibm-plex-sans-latin-500-normal.woff2", weight: "500" },
    { path: "./fonts/ibm-plex-sans-latin-600-normal.woff2", weight: "600" },
    { path: "./fonts/ibm-plex-sans-latin-700-normal.woff2", weight: "700" },
  ],
});

const plexMono = localFont({
  variable: "--font-mono",
  display: "swap",
  src: [
    { path: "./fonts/ibm-plex-mono-latin-400-normal.woff2", weight: "400" },
    { path: "./fonts/ibm-plex-mono-latin-500-normal.woff2", weight: "500" },
  ],
});

const plexCondensed = localFont({
  variable: "--font-display",
  display: "swap",
  src: [
    { path: "./fonts/ibm-plex-sans-condensed-latin-500-normal.woff2", weight: "500" },
    { path: "./fonts/ibm-plex-sans-condensed-latin-600-normal.woff2", weight: "600" },
  ],
});

export const metadata: Metadata = {
  title: "Trailmap — Living Architecture Maps",
  description: "Auto-generated, always-current architecture maps for your codebase",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable} ${plexCondensed.variable}`}>
      <body>
        <ReactQueryProvider>
          <PageTransition>{children}</PageTransition>
        </ReactQueryProvider>
      </body>
    </html>
  );
}
