#!/usr/bin/env node
/**
 * Publishes the built web app to a Convex deployment, which then serves it on
 * its own convex.site origin.
 *
 *   npm run build
 *   SITE_UPLOAD_TOKEN=... node scripts/publish-site.mjs https://<app>.convex.site
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep, extname } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
};

function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, base, out);
    else out.push("/" + relative(base, full).split(sep).join("/"));
  }
  return out;
}

const siteUrl = (process.argv[2] ?? "").replace(/\/+$/, "");
const token = process.env.SITE_UPLOAD_TOKEN;
const dist = process.env.SITE_DIST ?? "dist";

if (siteUrl === "") {
  console.error("Usage: node scripts/publish-site.mjs https://<app>.convex.site");
  process.exit(1);
}
if (!token) {
  console.error("Set SITE_UPLOAD_TOKEN to the value on the deployment.");
  process.exit(1);
}

const paths = walk(dist);
if (!paths.includes("/index.html")) {
  console.error(`No index.html in ${dist}/. Run the build first.`);
  process.exit(1);
}

let uploaded = 0;
for (const path of paths) {
  const body = readFileSync(join(dist, path.slice(1)));
  const response = await fetch(`${siteUrl}/x/site-upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
      "x-asset-path": path,
      "x-asset-type": TYPES[extname(path)] ?? "application/octet-stream",
    },
    body,
  });
  if (!response.ok) {
    console.error(`Failed ${path}: ${response.status} ${await response.text()}`);
    process.exit(1);
  }
  uploaded += 1;
  console.log(`  uploaded ${path} (${body.length} bytes)`);
}

console.log(`\nPublished ${uploaded} files. The app is live at ${siteUrl}/`);
