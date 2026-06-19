import { spawnSync } from "bun";

interface Step {
  label: string;
  args: string[];
}

const steps: Step[] = [
  { label: "server + shared", args: ["--noEmit"] },
  { label: "web", args: ["--noEmit", "-p", "web/tsconfig.json"] },
];

let failed = false;

for (const step of steps) {
  const result = spawnSync({
    cmd: ["bun", "x", "typescript", ...step.args],
    stdout: "pipe",
    stderr: "pipe",
  });

  const out = new TextDecoder().decode(result.stdout).trim();
  const err = new TextDecoder().decode(result.stderr).trim();
  const realErr = err
    .split("\n")
    .filter((l) => !/compiler options file|Starting incremental/.test(l))
    .join("\n")
    .trim();

  if (out || realErr) {
    console.log(`\n[${step.label}]`);
    if (out) console.log(out);
    if (realErr) console.log(realErr);
  } else {
    console.log(`[${step.label}] ok`);
  }

  if (result.exitCode !== 0) failed = true;
}

if (failed) {
  console.log("\ntypecheck failed");
  process.exit(1);
}
console.log("\ntypecheck ok");
