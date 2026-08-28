import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations/", import.meta.url));

export async function runMigrations(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        checksum VARCHAR(64),
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query("ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum VARCHAR(64)");

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((file) => /^\d+_[a-z0-9_]+\.sql$/.test(file))
      .sort();

    for (const file of files) {
      const sql = await readFile(`${MIGRATIONS_DIR}/${file}`, "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const applied = await client.query(
        "SELECT checksum FROM schema_migrations WHERE version = $1",
        [file]
      );
      if (applied.rowCount) {
        const recorded = applied.rows[0].checksum;
        if (recorded && recorded !== checksum) throw new Error(`Applied migration ${file} has been modified`);
        if (!recorded) await client.query("UPDATE schema_migrations SET checksum = $2 WHERE version = $1", [file, checksum]);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query("SELECT pg_advisory_xact_lock($1)", [918273645]);
        const raced = await client.query(
          "SELECT 1 FROM schema_migrations WHERE version = $1",
          [file]
        );
        if (!raced.rowCount) {
          await client.query(sql);
          await client.query(
          "INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)",
            [file, checksum]
          );
        }
        await client.query("COMMIT");
        console.log(`[DB] Applied migration ${file}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    client.release();
  }
}
