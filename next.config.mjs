/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */
  cacheComponents: true,
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
