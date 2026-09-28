import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit loads its own data files at runtime; keep it as a plain Node package
  // instead of bundling it, and ship the report fonts with the functions.
  serverExternalPackages: ["pdfkit"],
  outputFileTracingIncludes: {
    "/api/reports/[module]": ["./assets/fonts/**"],
    "/api/cron/[job]": ["./assets/fonts/**"],
  },
  async headers(){return [{source:"/:path*",headers:[
    {key:"X-Content-Type-Options",value:"nosniff"},
    {key:"Referrer-Policy",value:"strict-origin-when-cross-origin"},
    {key:"Permissions-Policy",value:"camera=(), microphone=(), geolocation=()"},
    {key:"X-Frame-Options",value:"SAMEORIGIN"},
    {key:"Cross-Origin-Opener-Policy",value:"same-origin"},
    {key:"Cross-Origin-Resource-Policy",value:"same-origin"},
    {key:"Strict-Transport-Security",value:"max-age=31536000; includeSubDomains"},
    {key:"Content-Security-Policy",value:"base-uri 'self'; form-action 'self'; frame-ancestors 'self'; object-src 'none'"}
  ]}]},
};

export default nextConfig;
