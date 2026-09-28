// The published entry points (dist) come from `publishConfig`, which only `pnpm publish` applies.
// `npm publish` would ship a package that points at `src`, which is not in the tarball.
const agent = process.env.npm_config_user_agent ?? "";
if (!agent.startsWith("pnpm/")) {
  console.error("Publish with `pnpm publish`: npm ignores publishConfig, so the package would point at src.");
  process.exit(1);
}
