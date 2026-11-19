// The names specs import tsmodel by: the published package first, then the names it had before,
// which still load so those specs keep working: @leostera/feynman, before the rename to tsmodel,
// and the workspace names specs used before it was published.
export const SPEC_NAMES = ["@tsmodel/tsmodel", "@leostera/feynman", "@feynman/spec"] as const;
export const PLAY_NAMES = ["@tsmodel/tsmodel/play", "@leostera/feynman/play", "@feynman/play"] as const;
export const CONFIG_NAMES = ["@tsmodel/tsmodel/config", "@leostera/feynman/config", "@feynman/cli"] as const;

/** Every name an import may use, for a bundler filter: exactly these, nothing under them. */
export function exactly(names: readonly string[]): RegExp {
  return new RegExp(`^(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join("|")})$`);
}
