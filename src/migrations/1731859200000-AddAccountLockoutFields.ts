import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAccountLockoutFields1731859200000 implements MigrationInterface {
    name = "AddAccountLockoutFields1731859200000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "accounts" 
            ADD COLUMN IF NOT EXISTS "failedLoginAttempts" integer NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS "lockedUntil" TIMESTAMP WITH TIME ZONE;
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "accounts" 
            DROP COLUMN IF EXISTS "failedLoginAttempts",
            DROP COLUMN IF EXISTS "lockedUntil";
        `);
    }
}
