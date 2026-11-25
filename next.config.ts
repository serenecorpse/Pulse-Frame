import type { NextConfig } from "next";

const config: NextConfig = {
  agentRules: false,
  // Lets the dev server hydrate at 127.0.0.1, which avoids service workers that other apps registered for localhost.
  allowedDevOrigins: ["127.0.0.1"],
};

export default config;
