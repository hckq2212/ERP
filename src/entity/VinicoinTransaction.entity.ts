import { Entity, Column, ManyToOne } from "typeorm";
import { TenantEntity } from "./TenantEntity";
import { Accounts } from "./Account.entity";

export enum VinicoinTransactionType {
    REWARD = "REWARD",
    SPEND = "SPEND",
    ADJUSTMENT = "ADJUSTMENT",
    MONTHLY_WITHDRAWAL = "MONTHLY_WITHDRAWAL"
}

@Entity()
export class VinicoinTransactions extends TenantEntity {

    @Column()
    amount: number;

    @Column({
        type: "enum",
        enum: VinicoinTransactionType,
        default: VinicoinTransactionType.REWARD
    })
    type: VinicoinTransactionType;

    @ManyToOne(() => Accounts)
    account: Accounts;

    @Column({ type: "varchar", length: 100, nullable: true, unique: true })
    idempotencyKey: string | null;

    @Column({ nullable: true })
    relatedTaskId: string;

    @Column({ nullable: true })
    relatedServiceId: string;

    @Column({ type: "text", nullable: true })
    description: string;
}
