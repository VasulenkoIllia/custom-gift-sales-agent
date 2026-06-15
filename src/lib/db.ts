import { Pool, PoolClient } from "pg";

function parseSslMode(databaseUrl: string): boolean {
    const url = new URL(databaseUrl);
    const sslmode = url.searchParams.get("sslmode");
    return sslmode === "require";
}

export function createDbPoolFromEnv(): Pool {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error(
            "Missing DATABASE_URL. Add DATABASE_URL to your environment.",
        );
    }

    return new Pool({
        connectionString,
        ssl: parseSslMode(connectionString) ? { rejectUnauthorized: false } : false,
    });
}

export async function withTransaction<T>(
    client: PoolClient,
    action: () => Promise<T>,
): Promise<T> {
    await client.query("BEGIN");
    try {
        const result = await action();
        await client.query("COMMIT");
        return result;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
}
