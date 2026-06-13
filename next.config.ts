import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Map images are served via short-lived signed URLs generated server-side
  // after an RLS check, so we render them with a plain <img>. No remote image
  // patterns are needed here.
  experimental: {
    // Server Actions are used for all mutations (create/save entry, invites…).
    serverActions: {
      bodySizeLimit: "8mb",
    },
  },
};

export default nextConfig;
