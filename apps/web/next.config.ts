import type { NextConfig } from "next";

const development = process.env.NODE_ENV !== "production";

function origin(value: string | undefined, fallback: string) {
  try {
    return new URL(value ?? fallback).origin;
  } catch {
    return new URL(fallback).origin;
  }
}

const apiOrigin = origin(process.env.NEXT_PUBLIC_API_URL, "http://localhost:4001/api");
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ""}`,
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://images.unsplash.com",
  `connect-src 'self' ${apiOrigin}${development ? " http://localhost:* ws://localhost:*" : ""}`,
  "font-src 'self' data:",
  "frame-src 'none'",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  ...(development ? [] : ["upgrade-insecure-requests"]),
];

function securityHeaders(frameAncestors: "'none'" | "*") {
  return [
    {
      key: "Content-Security-Policy",
      value: [...contentSecurityPolicy, `frame-ancestors ${frameAncestors}`].join("; "),
    },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    {
      key: "Permissions-Policy",
      value: "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
    },
  ];
}

const nextConfig: NextConfig = {
  devIndicators: false,
  transpilePackages: ["@leadvirt/types"],
  headers() {
    return Promise.resolve([
      {
        source: "/widget/frame",
        headers: securityHeaders("*"),
      },
      {
        source: "/((?!widget/frame).*)",
        headers: securityHeaders("'none'"),
      },
    ]);
  },
};

export default nextConfig;
