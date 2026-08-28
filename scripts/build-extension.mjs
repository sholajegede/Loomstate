#!/usr/bin/env node
/**
 * Builds the extension for the Chrome Web Store.
 *
 * The extension ships as plain modules, so building means assembling exactly
 * the files Chrome loads, checking the manifest is a valid Manifest V3 package
 * with every icon present, and zipping it with manifest.json at the top level.
 * Chrome rejects an archive whose manifest sits inside a folder.
 *
 *   node scripts/build-extension.mjs
 */
import {
  readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync, readdirSync, statSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import { zipSync } from "fflate";

const SOURCE = "extension";
const OUT = "extension/build";
const ZIP = "loomstate-extension.zip";
const REQUIRED_ICONS = ["16", "32", "48", "128"];

/** Files Chrome loads. Anything else stays out of the package. */
const SHIP = [
  "manifest.json",
  "background.js",
  "exclusions.js",
  "popup.html",
  "popup.js",
  "popup.css",
  "icons",
];

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, base, out);
    else out.push(relative(base, full).split(sep).join("/"));
  }
  return out;
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const item of SHIP) {
  const from = join(SOURCE, item);
  if (!existsSync(from)) fail(`${from} is missing.`);
  cpSync(from, join(OUT, item), { recursive: true });
}

// --- validate the manifest -------------------------------------------------

const manifestPath = join(OUT, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

if (manifest.manifest_version !== 3) {
  fail(`manifest_version is ${manifest.manifest_version}, not 3.`);
}
for (const field of ["name", "version", "description", "icons"]) {
  if (!manifest[field]) fail(`The manifest has no ${field}.`);
}
for (const size of REQUIRED_ICONS) {
  const path = manifest.icons[size];
  if (!path) fail(`The manifest has no ${size}px icon.`);
  if (!existsSync(join(OUT, path))) fail(`${path} is named in the manifest but missing.`);
}
for (const file of [manifest.background?.service_worker, manifest.action?.default_popup]) {
  if (file && !existsSync(join(OUT, file))) fail(`${file} is named in the manifest but missing.`);
}

// --- zip, with manifest.json at the root -----------------------------------

const files = walk(OUT);
if (!files.includes("manifest.json")) {
  fail("manifest.json is not at the top level of the build.");
}

const archive = {};
for (const file of files) archive[file] = new Uint8Array(readFileSync(join(OUT, file)));
const zipped = zipSync(archive, { level: 9 });
writeFileSync(ZIP, zipped);

console.log(`Built ${OUT} and wrote ${ZIP}\n`);
console.log(`  Manifest V${manifest.manifest_version}  ${manifest.name} ${manifest.version}`);
console.log(`  Icons: ${Object.keys(manifest.icons).join(", ")} px`);
console.log(`  Permissions: ${(manifest.permissions ?? []).join(", ")}`);
console.log(`  Host access: ${(manifest.host_permissions ?? []).join(", ")}\n`);
console.log("  Inside the archive:");
for (const file of files.sort()) {
  const bytes = statSync(join(OUT, file)).size;
  console.log(`    ${file.padEnd(22)} ${String(bytes).padStart(7)} bytes`);
}
console.log(`\n  ${files.length} files, ${zipped.length} bytes zipped.`);
