import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://lobly.gg"),
  title: {
    default: "LOBLY — Find players worth queuing again with",
    template: "%s — LOBLY",
  },
  description:
    "Find verified League of Legends teammates matched to your rank, role, language, and vibe. Discover live Duo, Flex, and ARAM lobbies with LOBLY.",
  keywords: [
    "League of Legends",
    "duo finder",
    "League teammate finder",
    "LFG",
    "ranked duo",
    "League companion app",
    "LOBLY",
  ],
  authors: [{ name: "LOBLY" }],
  creator: "LOBLY",
  category: "gaming",
  openGraph: {
    title: "LOBLY — Verified teammates. Better queues.",
    description:
      "Discover live League lobbies and find verified players who fit your rank, role, language, and vibe.",
    url: "https://lobly.gg",
    siteName: "LOBLY",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "LOBLY — Verified teammates. Better queues.",
    description:
      "Find League players worth queuing again with. Real profiles, live lobbies, one clean invite flow.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#07090e",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
