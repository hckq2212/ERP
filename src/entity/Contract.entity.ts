import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToOne, OneToMany } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Customers } from "./Customer.entity";
import { Opportunities } from "./Opportunity.entity";
import { Projects } from "./Project.entity";
import { PaymentMilestones } from "./PaymentMilestone.entity";
import { Debts } from "./Debt.entity";
import { ContractServices } from "./ContractService.entity";

@Entity()
export class Contracts extends BaseEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ unique: true })
    contractCode: string;

    @Column()
    name: string;

    @ManyToOne(() => Customers, (customer) => customer.contracts)
    customer: Customers;

    @ManyToOne(() => Opportunities, (opportunity) => opportunity.contracts)
    opportunity: Opportunities;

    @Column({ type: "decimal", precision: 15, scale: 2, default: 0 })
    cost: number;

    @Column({ type: "decimal", precision: 15, scale: 2, default: 0 })
    sellingPrice: number;

    @Column({ nullable: true })
    templateFile: string; // Cloudinary URL

    @Column({ nullable: true })
    signedFile: string; // Cloudinary URL

    @OneToMany(() => PaymentMilestones, (milestone) => milestone.contract)
    milestones: PaymentMilestones[];

    @OneToOne(() => Projects, (project) => project.contract)
    project: Projects;

    @OneToMany(() => ContractServices, (service) => service.contract)
    services: ContractServices[];

    @OneToMany(() => Debts, (debt) => debt.contract)
    debts: Debts[];
}
