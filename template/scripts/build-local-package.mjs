// Runs before `next build`. Inside the nano-unlock-next repository, npm links @nano133/unlock to the local
// package (../packages/unlock), which has no built files in a fresh clone: this builds them. In a lone copy
// of this folder (the "Deploy to Vercel" button), the package comes from npm, built, and this does nothing.

import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const local = fileURLToPath(new URL("../../packages/unlock", import.meta.url));
if (existsSync(`${local}/package.json`)) {
  console.log("Building the local @nano133/unlock first…");
  execSync("npm run build", { cwd: local, stdio: "inherit" });
}
