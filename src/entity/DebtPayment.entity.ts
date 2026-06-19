import { Entity, Column, ManyToOne } from "typeorm";
import { TenantEntity } from "./TenantEntity";
import { Debts } from "./Debt.entity";

@Entity()
export class DebtPayments extends TenantEntity {

    @ManyToOne(() => Debts, (debt) => debt.payments)
    debt: Debts;

    @Column({ type: "decimal", precision: 15, scale: 2 })
    amount: number;

    @Column({ type: "text", nullable: true })
    note: string;

    @Column({ type: "date" })
    paymentDate: Date;
}
