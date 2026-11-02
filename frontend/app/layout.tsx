import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

const description =
  "See any public GitHub repo as a 3D galaxy. Files are stars, folders are clusters, imports are threads, and an AI guide answers questions on the map.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://repo-atlas.vercel.app"),
  title: "Repo Atlas",
  description,
  applicationName: "Repo Atlas",
  openGraph: { title: "Repo Atlas", description, type: "website", siteName: "Repo Atlas" },
  twitter: { card: "summary_large_image", title: "Repo Atlas", description },
};

export const viewport: Viewport = {
  themeColor: "#04060d",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
