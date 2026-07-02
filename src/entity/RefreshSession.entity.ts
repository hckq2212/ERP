import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Accounts } from "./Account.entity";
import { Companies } from "./Company.entity";

@Entity()
@Index(["accountId"])
@Index(["companyId"])
@Index(["expiresAt"])
export class RefreshSessions extends BaseEntity {
    @ManyToOne(() => Accounts, { onDelete: "CASCADE" })
    @JoinColumn({ name: "accountId" })
    account: Accounts;

    @Column({ type: "varchar", length: 26 })
    accountId: string;

    @ManyToOne(() => Companies, { nullable: true, onDelete: "CASCADE" })
    @JoinColumn({ name: "companyId" })
    company?: Companies | null;

    @Column({ type: "varchar", length: 26, nullable: true })
    companyId?: string | null;

    @Column({ type: "varchar", length: 64 })
    tokenHash: string;

    @Column({ type: "timestamp" })
    expiresAt: Date;

    @Column({ type: "timestamp", nullable: true })
    revokedAt?: Date;
}
