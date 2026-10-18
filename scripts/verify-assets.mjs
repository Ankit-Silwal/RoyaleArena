import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  fileURLToPath(new URL("../public/assets/", import.meta.url)),
);
const manifest = JSON.parse(
  await readFile(path.join(root, "asset-manifest.json"), "utf8"),
);
for (const asset of manifest.files) {
  const target = path.resolve(root, asset.path);
  if (!target.startsWith(root + path.sep))
    throw new Error(`Invalid asset path: ${asset.path}`);
  const content = await readFile(target);
  const hash = createHash("sha256").update(content).digest("hex");
  if (hash !== asset.sha256)
    throw new Error(`Asset hash mismatch: ${asset.path}`);
}
console.log(
  `Verified ${manifest.files.length} extracted asset hashes for source ${manifest.sourceSha256}.`,
);
