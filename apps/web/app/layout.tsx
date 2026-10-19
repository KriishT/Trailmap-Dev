import type { Metadata } from "next";
import localFont from "next/font/local";
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
  variable: "--font-mono-face",
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
  title: { default: "Trailmap Evidence: architecture evidence from your code", template: "%s | Trailmap Evidence" },
  description:
    "Trailmap reads your repositories and draws the system, data-flow and network diagrams that PCI DSS, SOC 2 and DORA reviews ask for, with the code behind every line, and checks pull requests for drift.",
};

// Sets the saved theme before first paint so there is no flash. Falls back to the system setting.
const THEME_SCRIPT = `try{var t=localStorage.getItem("trailmap-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable} ${plexCondensed.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <a className="skip-link" href="#main">Skip to content</a>
        {children}
      </body>
    </html>
  );
}
