import type { NextConfig } from "next";
import { APP_BASE_PATH } from "./lib/application-scope";

const nextConfig: NextConfig = {
  basePath: APP_BASE_PATH,
  /* config options here */
};

export default nextConfig;
