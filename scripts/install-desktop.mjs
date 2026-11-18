#!/usr/bin/env node
// Installs the desktop app built by `pnpm desktop:build` (packages/app-desktop/release)
// on the current OS:
//
// - macOS:   copies the .app to /Applications (or ~/Applications with --user) and
//            clears the quarantine flag, since the build isn't signed/notarized.
// - Windows: runs the NSIS installer ("Yggdrasil Setup <version>.exe"); --silent
//            installs without the wizard.
// - Linux:   installs the .deb with apt/dpkg when available (needs sudo); otherwise,
//            or with --appimage, copies the AppImage to ~/.local/bin and adds a
//            desktop entry.
//
// Usage: pnpm desktop:install [--silent] [--user] [--appimage]
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktopDir = path.join(root, "packages/app-desktop");
const releaseDir = path.join(desktopDir, "release");
const { version } = JSON.parse(fs.readFileSync(path.join(desktopDir, "package.json"), "utf8"));
const args = new Set(process.argv.slice(2));

const fail = (msg) => {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
};
const run = (cmd, cmdArgs, opts = {}) => {
  console.log(`$ ${cmd} ${cmdArgs.join(" ")}`);
  execFileSync(cmd, cmdArgs, { stdio: "inherit", ...opts });
};
const has = (cmd) => spawnSync(process.platform === "win32" ? "where" : "which", [cmd]).status === 0;

if (!fs.existsSync(releaseDir)) fail(`No build found at ${releaseDir}. Run \`pnpm desktop:build\` first.`);
const files = fs.readdirSync(releaseDir);
// Only pick artifacts of the version currently in package.json, so an old build
// lying around in release/ is never installed by mistake.
const find = (test) => files.find((f) => f.includes(version) && test(f));

console.log(`Installing Yggdrasil ${version} (${process.platform}/${process.arch})\n`);

if (process.platform === "darwin") {
  // electron-builder writes the unpacked app to release/mac, mac-arm64 or mac-universal.
  const dirs = [`mac-${process.arch}`, "mac-universal", "mac"].filter((d) =>
    fs.existsSync(path.join(releaseDir, d)),
  );
  if (!dirs.length) fail(`No release/mac*/ folder found. Run \`pnpm desktop:build\` first.`);
  const appDir = path.join(releaseDir, dirs[0]);
  const app = fs.readdirSync(appDir).find((f) => f.endsWith(".app"));
  if (!app) fail(`No .app inside ${appDir}.`);
  if (dirs[0] === "mac" && process.arch === "arm64") {
    console.warn("⚠ This build is x64; it will run under Rosetta on this Apple Silicon Mac.\n");
  }

  const appsDir = args.has("--user") ? path.join(os.homedir(), "Applications") : "/Applications";
  fs.mkdirSync(appsDir, { recursive: true });
  const target = path.join(appsDir, app);

  if (spawnSync("pgrep", ["-f", `${target}/Contents/MacOS/`]).status === 0) {
    fail(`Yggdrasil is running from ${target}. Quit it and run this again.`);
  }
  if (fs.existsSync(target)) run("rm", ["-rf", target]);
  run("ditto", [path.join(appDir, app), target]);
  spawnSync("xattr", ["-dr", "com.apple.quarantine", target], { stdio: "inherit" });
  // Replacing an .app in place leaves Finder/Dock showing the cached (often generic)
  // icon: bump the bundle's mtime, re-register it with Launch Services, restart the Dock.
  spawnSync("touch", [target]);
  spawnSync(
    "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
    ["-f", target],
  );
  spawnSync("killall", ["Dock"]);
  console.log(`\n✔ Installed ${target}`);
  console.log(`  Open it with: open "${target}"`);
} else if (process.platform === "win32") {
  const exe = find((f) => f.endsWith(".exe") && !f.endsWith(".blockmap"));
  if (!exe) fail(`No ${version} .exe installer in ${releaseDir}. Run \`pnpm desktop:build\` first.`);
  const installerArgs = args.has("--silent") ? ["/S"] : [];
  run(path.join(releaseDir, exe), installerArgs);
  console.log(`\n✔ Installer finished (${exe})`);
} else if (process.platform === "linux") {
  const deb = find((f) => f.endsWith(".deb"));
  const appImage = find((f) => f.endsWith(".AppImage"));

  if (deb && !args.has("--appimage") && (has("apt") || has("dpkg"))) {
    const sudo = process.getuid?.() === 0 ? [] : ["sudo"];
    const debPath = path.join(releaseDir, deb);
    // apt resolves the .deb's dependencies; dpkg alone doesn't.
    const [cmd, ...rest] = has("apt")
      ? [...sudo, "apt", "install", "-y", debPath]
      : [...sudo, "dpkg", "-i", debPath];
    run(cmd, rest);
    console.log(`\n✔ Installed ${deb}. Launch it from the app menu or with: yggdrasil-desktop`);
  } else if (appImage) {
    const binDir = path.join(os.homedir(), ".local/bin");
    const target = path.join(binDir, "yggdrasil-desktop.AppImage");
    fs.mkdirSync(binDir, { recursive: true });
    fs.copyFileSync(path.join(releaseDir, appImage), target);
    fs.chmodSync(target, 0o755);

    const iconSrc = path.join(desktopDir, "resources/icon.png");
    const iconDir = path.join(os.homedir(), ".local/share/icons");
    const iconPath = path.join(iconDir, "yggdrasil-desktop.png");
    if (fs.existsSync(iconSrc)) {
      fs.mkdirSync(iconDir, { recursive: true });
      fs.copyFileSync(iconSrc, iconPath);
    }
    const appsDir = path.join(os.homedir(), ".local/share/applications");
    fs.mkdirSync(appsDir, { recursive: true });
    fs.writeFileSync(
      path.join(appsDir, "yggdrasil-desktop.desktop"),
      [
        "[Desktop Entry]",
        "Name=Yggdrasil",
        `Exec="${target}" %U`,
        `Icon=${iconPath}`,
        "Type=Application",
        "Categories=Development;",
        "MimeType=x-scheme-handler/yggdrasil;",
        "Terminal=false",
        "",
      ].join("\n"),
    );
    spawnSync("update-desktop-database", [appsDir], { stdio: "ignore" });
    console.log(`\n✔ Installed ${target} (+ desktop entry)`);
  } else {
    fail(`No ${version} .deb or .AppImage in ${releaseDir}. Run \`pnpm desktop:build\` on Linux first.`);
  }
} else {
  fail(`Unsupported platform: ${process.platform}`);
}
