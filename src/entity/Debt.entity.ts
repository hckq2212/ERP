import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToOne, JoinColumn, OneToMany } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Contracts } from "./Contract.entity";
import { PaymentMilestones } from "./PaymentMilestone.entity";
import { DebtPayments } from "./DebtPayment.entity";

@Entity()
export class Debts extends BaseEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @ManyToOne(() => Contracts, (contract) => contract.debts)
    contract: Contracts;

    @OneToOne(() => PaymentMilestones, (milestone) => milestone.debt)
    @JoinColumn()
    milestone: PaymentMilestones;

    @Column({ type: "decimal", precision: 15, scale: 2 })
    amount: number;

    @Column({ type: "date" })
    dueDate: Date;

    @Column()
    status: string;

    @Column()
    name: string;

    @OneToMany(() => DebtPayments, (payment) => payment.debt)
    payments: DebtPayments[];
}
