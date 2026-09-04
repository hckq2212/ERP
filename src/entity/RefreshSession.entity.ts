import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Accounts } from "./Account.entity";

@Entity()
@Index(["accountId"])
@Index(["expiresAt"])
export class RefreshSessions extends BaseEntity {
    @ManyToOne(() => Accounts, { onDelete: "CASCADE" })
    @JoinColumn({ name: "accountId" })
    account: Accounts;

    @Column({ type: "varchar", length: 26 })
    accountId: string;

    @Column({ type: "varchar", length: 64 })
    tokenHash: string;

    @Column({ type: "timestamp" })
    expiresAt: Date;

    @Column({ type: "timestamp", nullable: true })
    revokedAt?: Date;
}
