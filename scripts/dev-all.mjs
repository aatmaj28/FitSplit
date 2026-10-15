// Start everything for the demo: the API (FastAPI on :8000) and the web app (Vite on :5173).
//   npm run dev:all            (from the repo root)
// Without a backend virtualenv the web app still starts and runs fully offline from bundled demo data.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const procs = [];
const color = { api: "\x1b[36m", web: "\x1b[35m", reset: "\x1b[0m" };

function run(name, cmd, args, cwd) {
  const p = spawn(cmd, args, { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  const out = (chunk) => {
    for (const line of chunk.toString().split("\n")) if (line.trim()) console.log(`${color[name]}[${name}]${color.reset} ${line}`);
  };
  p.stdout.on("data", out);
  p.stderr.on("data", out);
  p.on("exit", (code) => console.log(`${color[name]}[${name}]${color.reset} exited (${code})`));
  procs.push(p);
  return p;
}

const uvicorn = join(ROOT, "backend", ".venv", "bin", "uvicorn");
if (existsSync(uvicorn)) {
  run("api", uvicorn, ["app.main:app", "--port", "8000", "--log-level", "warning"], join(ROOT, "backend"));
} else {
  console.log("[api] backend/.venv not found: skipping the API. The web app runs offline from bundled demo data.");
  console.log("[api] To set it up: cd backend && uv venv --python 3.11 .venv && VIRTUAL_ENV=.venv uv pip install -r requirements.txt");
}
if (!existsSync(join(ROOT, "frontend", "node_modules"))) {
  console.log("[web] installing frontend dependencies (first run)...");
  await new Promise((res) => spawn("npm", ["install"], { cwd: join(ROOT, "frontend"), stdio: "inherit" }).on("exit", res));
}
run("web", "npx", ["vite", "--port", "5173"], join(ROOT, "frontend"));
console.log("\n  Open http://localhost:5173  (guided demo: http://localhost:5173/demo)\n");

const stop = () => {
  for (const p of procs) p.kill("SIGINT");
  setTimeout(() => process.exit(0), 300);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
