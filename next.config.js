/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // We use a custom server.js, so tell Next not to create its own
  // Static export is off — we need server-side API routes
};

module.exports = nextConfig;
