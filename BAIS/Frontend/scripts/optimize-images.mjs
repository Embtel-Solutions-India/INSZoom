// One-off script (not part of the build) — converts the large marketing
// PNGs to WebP at visually-lossless quality, alongside the originals (which
// stay as the <picture> fallback for browsers without WebP support). Run
// manually with `node scripts/optimize-images.mjs` whenever a new marketing
// image needs the same treatment.
import sharp from "sharp";
import path from "node:path";
import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const imagesDir = path.join(__dirname, "..", "src", "assets", "images", "client-portal");

const targets = [
  "account-setup.png",
  "attorney-review.png",
  "consultant-review.png",
  "detailed-questionnaire.png",
  "form-filling.png",
  "secure-document.png",
  "status-tracking.png",
  "visa-category.png",
];

for (const file of targets) {
  const input = path.join(imagesDir, file);
  const output = path.join(imagesDir, file.replace(/\.png$/, ".webp"));
  const metadata = await sharp(input).metadata();
  await sharp(input).webp({ quality: 90 }).toFile(output);
  const { size: originalSize } = await stat(input);
  const { size: newSize } = await stat(output);
  console.log(
    `${file}: ${metadata.width}x${metadata.height} | ${(originalSize / 1024).toFixed(0)}KB -> ${(newSize / 1024).toFixed(0)}KB webp`
  );
}
