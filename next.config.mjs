// Security headers sent with every page and API response.
// - nosniff: the browser must trust Content-Type and never guess it, so an
//   uploaded text file can never be run as HTML or a script
// - frame-ancestors 'none' + X-Frame-Options DENY: no other site may load
//   TalentMatch in an <iframe> (clickjacking); the second is for old browsers
// - base-uri / object-src / form-action: an injected <base>, <object> or
//   <form action> cannot point somewhere else
// - Referrer-Policy: other sites only see our origin, never full URLs with ids
// - Permissions-Policy: the app never needs camera, microphone or location
// A full script-src CSP would need a per-request nonce, which forces every
// page to render dynamically; that conflicts with Cache Components, so script
// sources are not restricted here (see docs/authentication.md).
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */
  cacheComponents: true,
  // Do not advertise the framework in an X-Powered-By header.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  partialPrefetching: true,
  // pdfjs-dist loads its worker file ("pdf.worker.mjs") by a path relative to
  // its own module. Bundled into a server chunk that path does not exist and
  // every PDF fails to parse, so Node must load it from node_modules instead.
  serverExternalPackages: ["pdfjs-dist"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
