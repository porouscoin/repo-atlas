import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

const description =
  "Paste a GitHub repo and get a simple diagram of its main parts, how they depend on each other, and a plain-English explanation of each one.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://repo-atlas.vercel.app"),
  title: "Repo Atlas",
  description,
  applicationName: "Repo Atlas",
  openGraph: { title: "Repo Atlas", description, type: "website", siteName: "Repo Atlas" },
  twitter: { card: "summary_large_image", title: "Repo Atlas", description },
};

export const viewport: Viewport = {
  themeColor: "#0d1117",
  colorScheme: "dark light",
};

// Runs before paint: dark unless this browser picked light earlier.
const THEME_SCRIPT = `try{if(localStorage.getItem("theme")==="light")document.documentElement.dataset.theme="light"}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
