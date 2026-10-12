import "dotenv/config";
import { Client } from "pg";
import { RedisService } from "../shared/services/Redis.Service";

export const legacyServiceBudgetSql = `
UPDATE public.services AS service SET "isBudget" = TRUE
WHERE EXISTS (SELECT 1 FROM public.opportunity_services AS item WHERE item."serviceId" = service.id AND item.budget > 0)
   OR EXISTS (SELECT 1 FROM public.quotation_details AS item WHERE item."serviceId" = service.id AND item.budget > 0)
   OR EXISTS (SELECT 1 FROM public.contract_services AS item WHERE item."serviceId" = service.id AND item.budget > 0)`;

type MigrationClient = { query: (sql: string, values?: any[]) => Promise<any> };

export async function enableLegacyServiceBudgets(client: MigrationClient): Promise<boolean> {
    await client.query("BEGIN");
    let applied = false;
    try {
        await client.query(`ALTER TABLE public.services ADD COLUMN IF NOT EXISTS "isBudget" boolean NOT NULL DEFAULT false`);
        await client.query(`CREATE TABLE IF NOT EXISTS public.erp_data_migrations (name text PRIMARY KEY, "appliedAt" timestamptz NOT NULL DEFAULT now())`);
        const marker = await client.query(
            `INSERT INTO public.erp_data_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING name`,
            ["2026-10-12-service-is-budget"]
        );
        applied = marker.rows.length > 0;
        if (applied) await client.query(legacyServiceBudgetSql);
        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
    await RedisService.deleteCache("services:*");
    await RedisService.deleteCache("opportunities:*");
    await RedisService.deleteCache("service-packages:*");
    return applied;
}

async function main() {
    const ssl = process.env.DB_SSL === "true" ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === "true" } : false;
    const client = new Client(process.env.DATABASE_URL
        ? { connectionString: process.env.DATABASE_URL, ssl }
        : { host: process.env.DB_HOST || "localhost", port: Number(process.env.DB_PORT) || 5432,
            user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, ssl });
    await client.connect();
    try {
        const applied = await enableLegacyServiceBudgets(client);
        console.log(applied ? "Đã bật ngân sách cho dịch vụ có ngân sách lịch sử." : "Cập nhật đã chạy trước đó; giữ nguyên các cờ hiện tại.");
    } finally {
        await client.end();
    }
}

if (require.main === module) main().catch(() => {
    console.error("Cập nhật isBudget thất bại. Transaction đã được hủy; kiểm tra kết nối và schema database.");
    process.exitCode = 1;
});
