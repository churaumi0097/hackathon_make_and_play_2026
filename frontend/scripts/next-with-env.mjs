import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";

const sharedEnv = resolve(process.cwd(), "..", ".env");
if (existsSync(sharedEnv)) loadEnvFile(sharedEnv);

process.argv = [process.argv[0], "next", ...process.argv.slice(2)];
await import("next/dist/bin/next");
