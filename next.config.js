/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    // TODO: corriger les erreurs TS pré-existantes puis passer à false
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
}
module.exports = nextConfig
