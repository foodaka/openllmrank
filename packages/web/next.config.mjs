/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Transpile our workspace packages so Next can consume their TS sources.
  transpilePackages: ["@openllmrank/shared"],
};

export default nextConfig;
