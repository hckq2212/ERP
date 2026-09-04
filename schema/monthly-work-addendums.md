# Monthly Work Addendums Schema

Run this SQL before enabling the monthly work addendum flow in an environment
where TypeORM `synchronize` is disabled.

```sql
ALTER TYPE contract_addendums_status_enum ADD VALUE IF NOT EXISTS 'PENDING_SALE';
ALTER TYPE contract_addendums_status_enum ADD VALUE IF NOT EXISTS 'SALE_REJECTED';
ALTER TYPE contract_addendums_status_enum ADD VALUE IF NOT EXISTS 'PENDING_BOD';
ALTER TYPE contract_addendums_status_enum ADD VALUE IF NOT EXISTS 'BOD_REJECTED';
ALTER TYPE contract_addendums_status_enum ADD VALUE IF NOT EXISTS 'APPROVED';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'contract_addendums_type_enum') THEN
        CREATE TYPE contract_addendums_type_enum AS ENUM ('MANUAL', 'MONTHLY_TASKS');
    END IF;
END$$;

ALTER TABLE contract_addendums
    ADD COLUMN IF NOT EXISTS "projectId" varchar(26),
    ADD COLUMN IF NOT EXISTS "type" contract_addendums_type_enum NOT NULL DEFAULT 'MANUAL',
    ADD COLUMN IF NOT EXISTS "monthKey" varchar(7),
    ADD COLUMN IF NOT EXISTS "selectedItems" jsonb DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS "saleReviewedById" varchar(26),
    ADD COLUMN IF NOT EXISTS "saleReviewedAt" timestamptz,
    ADD COLUMN IF NOT EXISTS "saleReviewNote" text,
    ADD COLUMN IF NOT EXISTS "bodReviewedById" varchar(26),
    ADD COLUMN IF NOT EXISTS "bodReviewedAt" timestamptz,
    ADD COLUMN IF NOT EXISTS "bodReviewNote" text;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_contract_addendums_project'
    ) THEN
        ALTER TABLE contract_addendums
            ADD CONSTRAINT fk_contract_addendums_project
            FOREIGN KEY ("projectId") REFERENCES projects(id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_contract_addendums_sale_reviewer'
    ) THEN
        ALTER TABLE contract_addendums
            ADD CONSTRAINT fk_contract_addendums_sale_reviewer
            FOREIGN KEY ("saleReviewedById") REFERENCES users(id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_contract_addendums_bod_reviewer'
    ) THEN
        ALTER TABLE contract_addendums
            ADD CONSTRAINT fk_contract_addendums_bod_reviewer
            FOREIGN KEY ("bodReviewedById") REFERENCES users(id);
    END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_monthly_work_addendum_active
ON contract_addendums ("contractId", "projectId", "monthKey", "type")
WHERE "type" = 'MONTHLY_TASKS'
  AND status NOT IN ('SALE_REJECTED', 'BOD_REJECTED', 'CANCELLED');
```
