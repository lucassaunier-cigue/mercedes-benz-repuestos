import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

const dataDir = resolve(process.env.DATA_DIR || "data");
const sourcePath = join(dataDir, "catalog.sqlite");
const backupDir = join(dataDir, "backups");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const destinationPath = join(backupDir, `catalog-${stamp}.sqlite`);

await mkdir(backupDir, { recursive: true });
const database = new DatabaseSync(sourcePath);

try {
  await backup(database, destinationPath);
  console.log(destinationPath);
} finally {
  database.close();
}
