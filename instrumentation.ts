/** Runs once when the server starts. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startMotion } = await import("./lib/motion");
  startMotion();
  // The sentence model takes about sixteen seconds to load; nobody should meet that on their first search.
  const { warmMeaning } = await import("./lib/text/embed");
  void warmMeaning();
}
