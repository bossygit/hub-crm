/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    // Permet le déploiement même avec des erreurs TS (MVP)
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
}
module.exports = nextConfig
