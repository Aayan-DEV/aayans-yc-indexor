/** Runs once when the server starts. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startMotion } = await import("./lib/motion");
  startMotion(); // macOS only, and a no-op everywhere else
  // The sentence model takes about sixteen seconds to load; nobody should meet that on their first search.
  const { warmMeaning } = await import("./lib/text/embed");
  void warmMeaning();
  // And where there is no CoreML, the 81 MB text tower loads now rather than inside somebody's first query.
  const { warmOnnx } = await import("./lib/clip/onnx");
  void warmOnnx();
}
