import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToOne } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Contracts } from "./Contract.entity";
import { Debts } from "./Debt.entity";

export enum MilestoneStatus {
    PENDING = "PENDING",
    COMPLETED = "COMPLETED"
}

@Entity()
export class PaymentMilestones extends BaseEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    name: string;

    @ManyToOne(() => Contracts, (contract) => contract.milestones)
    contract: Contracts;

    @Column({ type: "decimal", precision: 5, scale: 2 })
    percentage: number;

    @Column({ type: "decimal", precision: 15, scale: 2 })
    amount: number;

    @Column({
        type: "enum",
        enum: MilestoneStatus,
        default: MilestoneStatus.PENDING
    })
    status: MilestoneStatus;

    @Column({ type: "text", nullable: true })
    description: string;

    @OneToOne(() => Debts, (debt) => debt.milestone)
    debt: Debts;
}
