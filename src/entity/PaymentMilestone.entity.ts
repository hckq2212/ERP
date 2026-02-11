import { Entity, Column, ManyToOne, OneToOne } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Contracts } from "./Contract.entity";
import { Debts } from "./Debt.entity";
import { ContractAddendums } from "./ContractAddendum.entity";

export enum MilestoneStatus {
    PENDING = "PENDING",
    COMPLETED = "COMPLETED"
}

@Entity()
export class PaymentMilestones extends BaseEntity {

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

    @Column({ type: "date", nullable: true })
    dueDate: Date;

    @OneToOne(() => Debts, (debt) => debt.milestone)
    debt: Debts;

    @ManyToOne(() => ContractAddendums, (addendum) => addendum.milestones, { nullable: true })
    addendum: ContractAddendums;
}
