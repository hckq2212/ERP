import { Entity, Column, ManyToOne } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Debts } from "./Debt.entity";

@Entity()
export class DebtPayments extends BaseEntity {

    @ManyToOne(() => Debts, (debt) => debt.payments)
    debt: Debts;

    @Column({ type: "decimal", precision: 15, scale: 2 })
    amount: number;

    @Column({ type: "text", nullable: true })
    note: string;

    @Column({ type: "date" })
    paymentDate: Date;
}
