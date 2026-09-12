import { readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

const metaDir = fileURLToPath(new URL("../drizzle/meta/", import.meta.url));
const archiveDir = fileURLToPath(new URL("../drizzle/snapshot-artifacts/", import.meta.url));
const compressedSuffix = "_snapshot.json.zlib.b64";
const snapshotSuffix = "_snapshot.json";

function minifySnapshot(value: string): string {
  return JSON.stringify(JSON.parse(value));
}

export async function materializeSnapshots(): Promise<void> {
  const files = await readdir(archiveDir);
  for (const file of files.filter((name) => name.endsWith(compressedSuffix))) {
    const compressed = (await readFile(`${archiveDir}/${file}`, "utf8")).trim();
    const snapshot = inflateSync(Buffer.from(compressed, "base64")).toString("utf8");
    const output = `${metaDir}/${file.replace(/\.zlib\.b64$/, "")}`;
    await writeFile(output, snapshot.endsWith("\n") ? snapshot : `${snapshot}\n`, "utf8");
  }
}

export async function packSnapshots(): Promise<void> {
  const files = await readdir(metaDir);
  for (const file of files.filter((name) => name.endsWith(snapshotSuffix) && name !== "0000_snapshot.json")) {
    const source = minifySnapshot(await readFile(`${metaDir}/${file}`, "utf8"));
    const compressedPath = `${archiveDir}/${file}.zlib.b64`;
    let unchanged = false;
    try {
      const existing = (await readFile(compressedPath, "utf8")).trim();
      const unpacked = minifySnapshot(inflateSync(Buffer.from(existing, "base64")).toString("utf8"));
      unchanged = unpacked === source;
    } catch {
      unchanged = false;
    }
    if (!unchanged) {
      const packed = deflateSync(Buffer.from(source), { level: 9 }).toString("base64");
      await writeFile(compressedPath, `${packed}\n`, "utf8");
    }
  }
}

if (import.meta.main) {
  const command = process.argv[2];
  if (command === "materialize") await materializeSnapshots();
  else if (command === "pack") await packSnapshots();
  else throw new Error("Expected snapshot command: materialize or pack");
}
