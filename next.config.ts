import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // onnxruntime ships a native binary, which a bundler must not try to inline.
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node"],
  // The packed sheet of pile logos is a build artefact: it only changes when the build script is run again, and it is
  // the one request the whole pile waits on, so it should never be fetched twice.
  headers: async () => [{ source: "/atlas/:file*", headers: [{ key: "cache-control", value: "public, max-age=31536000, immutable" }] }],
};

export default nextConfig;
