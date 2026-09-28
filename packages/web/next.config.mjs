// Production *.vercel.app aliases serve a full copy of the site. Send them to
// the real domain so links and search signals consolidate on openllmrank.io.
// /api/* is left alone so webhooks registered against an alias keep working
// (Stripe does not follow redirects). Preview deployment hosts are unaffected.
const VERCEL_ALIAS_HOSTS = [
  "openllmrank.vercel.app",
  "openllmrank-foodaka.vercel.app",
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Transpile our workspace packages so Next can consume their TS sources.
  transpilePackages: ["@openllmrank/shared"],
  async redirects() {
    return VERCEL_ALIAS_HOSTS.map((host) => ({
      source: "/:path((?!api/).*)",
      has: [{ type: "host", value: host }],
      destination: "https://openllmrank.io/:path",
      permanent: true,
    }));
  },
};

export default nextConfig;
