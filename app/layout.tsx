import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "fulfillment-helper-aeon.huy61h1.chatgpt.site";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const metadataBase = new URL(`${protocol}://${host}`);

  return {
    metadataBase,
    title: "Fulfillment SmartOps — Tìm đúng hàng, soạn đơn nhanh",
    description: "Công cụ tra cứu sản phẩm, tồn kho, loss, hạn dùng, POG và soạn đơn dành cho đội Fulfillment.",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: {
      type: "website",
      locale: "vi_VN",
      title: "Fulfillment SmartOps",
      description: "Tìm đúng hàng. Soạn đơn nhanh.",
      images: [{ url: new URL("/og-aeon.png", metadataBase).toString(), width: 1200, height: 630, alt: "Fulfillment SmartOps" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Fulfillment SmartOps",
      description: "Tìm đúng hàng. Soạn đơn nhanh.",
      images: [new URL("/og-aeon.png", metadataBase).toString()],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
