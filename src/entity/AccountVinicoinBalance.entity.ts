import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { TenantEntity } from "./TenantEntity";
import { Accounts } from "./Account.entity";

@Entity()
@Index(["accountId", "company"], { unique: true })
export class AccountVinicoinBalances extends TenantEntity {

    @Column({ type: "varchar", length: 26 })
    accountId: string;

    @ManyToOne(() => Accounts, { onDelete: "CASCADE" })
    @JoinColumn({ name: "accountId" })
    account: Accounts;

    @Column({ type: "decimal", precision: 15, scale: 3, default: 0 })
    vinicoin: number;

    @Column({ type: "decimal", precision: 15, scale: 3, default: 0 })
    vinicoinTotal: number;

    @Column({ type: "decimal", precision: 15, scale: 3, default: 0 })
    vinicoinWithdrawn: number;
}
