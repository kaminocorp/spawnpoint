#!/usr/bin/env node
// scripts/capture-login-video.mjs
//
// Captures the sign-in page WebGL particle animation as an MP4.
// The output (docs/assets/login-animation.mp4) is then uploaded to GitHub
// to get a CDN URL, which goes into the README <video> embed.
//
// Prerequisites:
//   1. pnpm install              (installs puppeteer-core)
//   2. pnpm frontend:dev         (Next.js dev server on :3000)
//   3. pnpm capture:video        (this script)

import puppeteer from "puppeteer-core";
import { execSync } from "node:child_process";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
];

const PAGE_URL = "http://localhost:3000/sign-in";
const FRAMES_DIR = "/tmp/corellia-signin-frames";
const OUT_FILE = resolve(ROOT, "docs/assets/login-animation.mp4");

// 4s lets WebGL init + all 6 shape .bin files load over localhost
const INIT_WAIT_MS = 4_000;
// One full drift (4–8s) + morph (7s) + hold (7s) ≈ 18s — 20s gives a clean clip
const CAPTURE_MS = 20_000;

const W = 1280;
const H = 720;

function findChrome() {
  for (const p of CHROME_CANDIDATES) {
    if (existsSync(p)) return p;
  }
  throw new Error(
    "Chrome not found. Checked:\n" +
      CHROME_CANDIDATES.map((p) => `  ${p}`).join("\n") +
      "\nInstall Chrome, or edit CHROME_CANDIDATES at the top of this script."
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const chrome = findChrome();
  console.log(`Chrome: ${chrome}\n`);

  if (existsSync(FRAMES_DIR)) rmSync(FRAMES_DIR, { recursive: true });
  mkdirSync(FRAMES_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: false, // headed = full GPU WebGL; software rendering produces washed-out particles
    defaultViewport: { width: W, height: H },
    args: [
      `--window-size=${W},${H}`,
      "--disable-infobars",
      "--no-default-browser-check",
      "--no-first-run",
    ],
  });

  const [page] = await browser.pages();

  try {
    console.log(`→ Loading ${PAGE_URL}`);
    await page.goto(PAGE_URL, { waitUntil: "networkidle0", timeout: 30_000 });

    console.log(`→ Waiting ${INIT_WAIT_MS / 1000}s for WebGL init…`);
    await sleep(INIT_WAIT_MS);

    console.log(`→ Capturing ${CAPTURE_MS / 1000}s…`);
    const t0 = Date.now();
    let n = 0;

    while (Date.now() - t0 < CAPTURE_MS) {
      await page.screenshot({
        path: join(FRAMES_DIR, `frame-${String(n).padStart(6, "0")}.png`),
      });
      n++;
      if (n % 10 === 0) {
        const s = ((Date.now() - t0) / 1000).toFixed(1);
        const fps = (n / parseFloat(s)).toFixed(1);
        process.stdout.write(`\r  ${n} frames | ${s}s | ${fps} fps`);
      }
    }

    const elapsedMs = Date.now() - t0;
    const fps = Math.round((n / elapsedMs) * 1000);
    console.log(`\n  Total: ${n} frames at ~${fps} fps`);

    await browser.close();

    console.log("\n→ Encoding MP4…");
    execSync(
      [
        "ffmpeg -y",
        `-framerate ${fps}`,
        `-i "${FRAMES_DIR}/frame-%06d.png"`,
        "-c:v libx264 -pix_fmt yuv420p",
        "-crf 20",               // quality: 18 = near-lossless, 28 = smaller file
        "-movflags +faststart",  // web-friendly: moov atom at front
        `"${OUT_FILE}"`,
      ].join(" "),
      { stdio: "inherit" }
    );

    rmSync(FRAMES_DIR, { recursive: true });

    console.log(`\n✓  Saved → ${OUT_FILE}`);
    console.log(`\nNext: get a GitHub CDN URL for README.md:`);
    console.log(`  1. Open any issue or PR in this repo on GitHub.`);
    console.log(`  2. Drag  docs/assets/login-animation.mp4  into the comment box.`);
    console.log(`  3. Copy the resulting URL (ends in .mp4).`);
    console.log(`  4. Replace VIDEO_URL in the README.md <video> tag with that URL.`);
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
}

main().catch((err) => {
  console.error("\nError:", err.message);
  process.exit(1);
});
