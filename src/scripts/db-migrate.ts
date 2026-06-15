import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDbPoolFromEnv, withTransaction } from "../lib/db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.resolve(__dirname, "../../db/migrations");

async function ensureMigrationsTable(): Promise<void> {
    const pool = createDbPoolFromEnv();
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version TEXT PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
    } finally {
        await pool.end();
    }
}

async function getMigrationFiles(): Promise<string[]> {
    const entries = await fs.readdir(MIGRATIONS_DIR, { withFileTypes: true });
    return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b));
}

async function applyMigrations(): Promise<void> {
    await ensureMigrationsTable();
    const files = await getMigrationFiles();
    const pool = createDbPoolFromEnv();

    try {
        const appliedSet = new Set<string>();
        const appliedRows = await pool.query<{
            version: string;
        }>("SELECT version FROM schema_migrations");
        for (const row of appliedRows.rows) {
            appliedSet.add(row.version);
        }

        for (const file of files) {
            if (appliedSet.has(file)) {
                continue;
            }

            const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), "utf8");
            const client = await pool.connect();
            try {
                await withTransaction(client, async () => {
                    await client.query(sql);
                    await client.query(
                        "INSERT INTO schema_migrations (version) VALUES ($1)",
                        [file],
                    );
                });
                console.log(`Applied migration: ${file}`);
            } finally {
                client.release();
            }
        }

        if (files.length === 0) {
            console.log("No migration files found.");
            return;
        }

        console.log("Migrations are up to date.");
    } finally {
        await pool.end();
    }
}

applyMigrations().catch((error) => {
    console.error(error instanceof Error ? error.message : "Unknown migration error");
    process.exit(1);
});
