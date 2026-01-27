import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToOne, OneToMany } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Customers } from "./Customer.entity";
import { Opportunities } from "./Opportunity.entity";
import { Projects } from "./Project.entity";
import { PaymentMilestones } from "./PaymentMilestone.entity";
import { Debts } from "./Debt.entity";
import { ContractServices } from "./ContractService.entity";

export enum ContractStatus {
    DRAFT = "DRAFT",
    PROPOSAL_UPLOADED = "PROPOSAL_UPLOADED",
    PROPOSAL_APPROVED = "PROPOSAL_APPROVED",
    SIGNED = "SIGNED",
    COMPLETED = "COMPLETED",
    CANCELLED = "CANCELLED"
}

@Entity()
export class Contracts extends BaseEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({
        type: "enum",
        enum: ContractStatus,
        default: ContractStatus.DRAFT
    })
    status: ContractStatus;

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
    proposal_contract: string; // Cloudinary URL

    @Column({ nullable: true })
    signed_contract: string; // Cloudinary URL

    @Column({ type: "json", nullable: true })
    attachments: { type: string, name: string, url: string, size?: number, publicId?: string }[];

    @OneToMany(() => PaymentMilestones, (milestone) => milestone.contract)
    milestones: PaymentMilestones[];

    @OneToOne(() => Projects, (project) => project.contract)
    project: Projects;

    @OneToMany(() => ContractServices, (service) => service.contract)
    services: ContractServices[];

    @OneToMany(() => Debts, (debt) => debt.contract)
    debts: Debts[];
}
