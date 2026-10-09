// Runs before a build. Inside the nano-unlock-next repository, npm LINKS @nano133/unlock to the local package
// (packages/unlock), which has no built files in a fresh clone: this builds them. In every other case the
// package is a real copy from npm, already built, and this does nothing: a lone copy of this folder (the
// "Deploy" buttons), and also a full clone in which only this folder was installed.

import { existsSync, realpathSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, sep } from "node:path";

/** Where the installed package really is: this folder's node_modules, or a parent's (a workspace). */
function installed() {
  let dir = fileURLToPath(new URL("..", import.meta.url));
  for (;;) {
    const at = join(dir, "node_modules", "@nano133", "unlock");
    if (existsSync(at)) return realpathSync(at);
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

const at = installed();
// A link leads out of node_modules, into the package's own source folder.
if (at && !at.includes(`${sep}node_modules${sep}`) && existsSync(join(at, "tsconfig.json"))) {
  console.log("Building the local @nano133/unlock first…");
  execSync("npm run build", { cwd: at, stdio: "inherit" });
}
