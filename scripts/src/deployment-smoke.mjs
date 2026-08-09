#!/usr/bin/env node

const rawOrigin = process.argv[2] ?? process.env.TILTCHECK_ORIGIN;

if (!rawOrigin) {
  console.error("Usage: pnpm run smoke:deploy -- https://your-tiltcheck-host.example");
  console.error("Or set TILTCHECK_ORIGIN.");
  process.exit(2);
}

let origin;
try {
  origin = new URL(rawOrigin);
} catch {
  console.error(`Invalid origin: ${rawOrigin}`);
  process.exit(2);
}

if (!/^https?:$/.test(origin.protocol)) {
  console.error("Origin must use http or https.");
  process.exit(2);
}

origin.pathname = origin.pathname.replace(/\/$/, "");
origin.search = "";
origin.hash = "";

const checks = [
  { path: "/healthz", kind: "health" },
  { path: "/", kind: "html" },
  { path: "/demo", kind: "html" },
  { path: "/privacy", kind: "html" },
  { path: "/terms", kind: "html" },
];

const failures = [];

for (const check of checks) {
  const url = new URL(check.path, origin);
  const started = Date.now();

  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": "TiltCheck deployment smoke check" },
      signal: AbortSignal.timeout(10_000),
    });
    const elapsed = Date.now() - started;
    const contentType = response.headers.get("content-type") ?? "";
    const body = await response.text();

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    if (check.kind === "health") {
      if (!contentType.includes("application/json")) {
        throw new Error(`expected JSON, got ${contentType || "unknown content type"}`);
      }
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        throw new Error("health response was not valid JSON");
      }
      if (payload?.status !== "ok" || payload?.service !== "tiltcheck-api") {
        throw new Error("unexpected health payload");
      }
    } else {
      if (!contentType.includes("text/html")) {
        throw new Error(`expected HTML, got ${contentType || "unknown content type"}`);
      }
      if (!body.includes('<div id="root"></div>')) {
        throw new Error("TiltCheck app root was not present");
      }
      if (!body.includes("TiltCheck")) {
        throw new Error("TiltCheck page metadata was not present");
      }
    }

    console.log(`PASS ${check.path.padEnd(10)} ${response.status} ${elapsed}ms`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${check.path}: ${message}`);
    console.error(`FAIL ${check.path.padEnd(10)} ${message}`);
  }
}

if (failures.length > 0) {
  console.error(`\nDeployment smoke check failed (${failures.length}/${checks.length}).`);
  process.exit(1);
}

console.log(`\nDeployment smoke check passed for ${origin.origin}.`);
