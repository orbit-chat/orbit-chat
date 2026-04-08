#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, copyFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const websiteRoot = path.resolve(appRoot, "..", "orbit-chat.github.io");
const releaseDir = path.resolve(appRoot, "release");
const downloadsDir = path.resolve(websiteRoot, "downloads");
const websiteIndexPath = path.resolve(websiteRoot, "index.html");
const packageJsonPath = path.resolve(appRoot, "package.json");
const isDryRun = process.argv.includes("--dry-run");

function fail(message) {
  console.error(`\n[release:publish] ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "pipe",
    encoding: "utf8",
    ...options,
  });

  if (result.error) {
    fail(`Failed to run ${command}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const stderr = (result.stderr || "").trim();
    const stdout = (result.stdout || "").trim();
    fail([
      `Command failed: ${command} ${args.join(" ")}`,
      stderr ? `stderr: ${stderr}` : "",
      stdout ? `stdout: ${stdout}` : "",
    ].filter(Boolean).join("\n"));
  }

  return result.stdout.trim();
}

function selectArtifacts(version) {
  if (!existsSync(releaseDir)) {
    fail(`Release directory not found: ${releaseDir}. Run a dist build first.`);
  }

  const files = readdirSync(releaseDir).filter((name) => {
    const fullPath = path.resolve(releaseDir, name);
    return existsSync(fullPath) && !name.endsWith(".blockmap") && !name.endsWith(".yml") && !name.endsWith(".yaml");
  });

  const expectedWindows = `Orbit Chat Setup ${version}.exe`;
  const expectedMac = `Orbit Chat-${version}-arm64-mac.zip`;

  const windows = files.find((name) => name === expectedWindows) || files.find((name) => name.endsWith(".exe") && name.includes(version));
  const mac = files.find((name) => name === expectedMac) || files.find((name) => name.endsWith("-mac.zip") && name.includes(version));

  if (!windows && !mac) {
    fail(`No release artifacts found for version ${version} in ${releaseDir}.`);
  }

  return {
    windows,
    mac,
    uploadFiles: files.filter((name) => name.includes(version)).map((name) => path.resolve(releaseDir, name)),
  };
}

function ensureGhCli() {
  const check = spawnSync("gh", ["--version"], { stdio: "pipe", encoding: "utf8" });
  if (check.error || check.status !== 0) {
    fail("GitHub CLI (gh) is required. Install it and run `gh auth login` first.");
  }
}

function upsertGitHubRelease(version, uploadFiles) {
  const tag = `v${version}`;
  const title = `Orbit Chat v${version}`;
  const notes = `Automated release for ${title}.`;

  const view = spawnSync("gh", ["release", "view", tag], {
    cwd: appRoot,
    stdio: "pipe",
    encoding: "utf8",
  });

  if (view.status === 0) {
    console.log(`[release:publish] Release ${tag} exists, uploading updated assets...`);
  } else {
    console.log(`[release:publish] Creating release ${tag}...`);
    if (!isDryRun) {
      run("gh", ["release", "create", tag, "--title", title, "--notes", notes], { cwd: appRoot });
    }
  }

  if (uploadFiles.length === 0) {
    fail(`No files were selected to upload for ${tag}.`);
  }

  if (!isDryRun) {
    run("gh", ["release", "upload", tag, ...uploadFiles, "--clobber"], { cwd: appRoot });
    console.log(`[release:publish] Uploaded ${uploadFiles.length} files to ${tag}.`);
  } else {
    console.log(`[release:publish] Dry run: would upload ${uploadFiles.length} files to ${tag}.`);
  }
}

function copyWebsiteDownloads(artifacts) {
  if (!existsSync(websiteRoot)) {
    fail(`Website repo not found at ${websiteRoot}`);
  }

  mkdirSync(downloadsDir, { recursive: true });

  const copied = [];

  if (artifacts.mac) {
    const source = path.resolve(releaseDir, artifacts.mac);
    const target = path.resolve(downloadsDir, artifacts.mac);
    if (!isDryRun) {
      copyFileSync(source, target);
    }
    copied.push(artifacts.mac);
  }

  if (artifacts.windows) {
    const source = path.resolve(releaseDir, artifacts.windows);
    const target = path.resolve(downloadsDir, artifacts.windows);
    if (!isDryRun) {
      copyFileSync(source, target);
    }
    copied.push(artifacts.windows);
  }

  if (copied.length === 0) {
    fail("No website download files were copied.");
  }

  console.log(`[release:publish] Synced website downloads: ${copied.join(", ")}`);
}

function updateWebsiteIndex(version, artifacts) {
  if (!existsSync(websiteIndexPath)) {
    fail(`Website index not found at ${websiteIndexPath}`);
  }

  const raw = readFileSync(websiteIndexPath, "utf8");

  const encodedMac = artifacts.mac ? encodeURIComponent(artifacts.mac).replace(/%2F/g, "/") : null;
  const encodedWindows = artifacts.windows ? encodeURIComponent(artifacts.windows).replace(/%2F/g, "/") : null;

  let updated = raw.replace(/(macOS \+ Windows installers \(v)[^)]+(\))/, `$1${version}$2`);

  if (encodedMac) {
    updated = updated.replace(/href="downloads\/Orbit%20Chat-[^"]+-mac\.zip"/, `href="downloads/${encodedMac}"`);
  }

  if (encodedWindows) {
    updated = updated.replace(/href="downloads\/Orbit%20Chat%20Setup%20[^"]+\.exe"/, `href="downloads/${encodedWindows}"`);
  }

  if (updated !== raw) {
    if (!isDryRun) {
      writeFileSync(websiteIndexPath, updated, "utf8");
      console.log("[release:publish] Updated website download links in index.html");
    } else {
      console.log("[release:publish] Dry run: would update website download links in index.html");
    }
  } else {
    console.log("[release:publish] No changes were needed in website index.html");
  }
}

function main() {
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const version = String(pkg.version || "").trim();
  if (!version) {
    fail("package.json version is missing.");
  }

  console.log(`[release:publish] Preparing release for version ${version}${isDryRun ? " (dry run)" : ""}`);

  ensureGhCli();
  const artifacts = selectArtifacts(version);
  upsertGitHubRelease(version, artifacts.uploadFiles);
  copyWebsiteDownloads(artifacts);
  updateWebsiteIndex(version, artifacts);

  console.log("[release:publish] Done.");
}

main();
