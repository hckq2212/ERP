import { Entity, Column, ManyToOne, OneToMany } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Contracts } from "./Contract.entity";
import { ContractServices } from "./ContractService.entity";
import { PaymentMilestones } from "./PaymentMilestone.entity";
import { Quotations } from "./Quotation.entity";
import { Projects } from "./Project.entity";
import { Users } from "./User.entity";

export enum AddendumStatus {
    DRAFT = "DRAFT",
    SIGNED = "SIGNED",
    CANCELLED = "CANCELLED",
    PENDING_SALE = "PENDING_SALE",
    SALE_REJECTED = "SALE_REJECTED",
    PENDING_BOD = "PENDING_BOD",
    BOD_REJECTED = "BOD_REJECTED",
    APPROVED = "APPROVED"
}

export enum AddendumType {
    MANUAL = "MANUAL",
    MONTHLY_TASKS = "MONTHLY_TASKS"
}

@Entity()
export class ContractAddendums extends BaseEntity {

    @Column()
    name: string; // e.g., "Phụ lục 01: Bổ sung hạng mục quay phim"

    @ManyToOne(() => Contracts, (contract) => contract.addendums)
    contract: Contracts;

    @ManyToOne(() => Projects, { nullable: true })
    project: Projects;

    @Column({
        type: "enum",
        enum: AddendumType,
        default: AddendumType.MANUAL
    })
    type: AddendumType;

    @Column({ type: "varchar", length: 7, nullable: true })
    monthKey: string;

    @Column({ type: "jsonb", nullable: true, default: [] })
    selectedItems: {
        sourceContractServiceId: string,
        serviceId: string,
        serviceName: string,
        packageName?: string,
        isPackageService?: boolean,
        sellingPrice?: number,
        cost?: number
    }[];

    @Column({ type: "decimal", precision: 15, scale: 3, default: 0 })
    sellingPrice: number; // Có thể âm nếu là phụ lục cắt giảm

    @Column({ type: "decimal", precision: 15, scale: 3, default: 0 })
    cost: number;

    @Column({ type: "text", nullable: true })
    description: string;

    @Column({ nullable: true })
    signed_contract: string; // URL file phụ lục đã ký

    @Column({
        type: "enum",
        enum: AddendumStatus,
        default: AddendumStatus.DRAFT
    })
    status: AddendumStatus;

    @ManyToOne(() => Users, { nullable: true })
    saleReviewedBy: Users;

    @Column({ type: "timestamptz", nullable: true })
    saleReviewedAt: Date;

    @Column({ type: "text", nullable: true })
    saleReviewNote: string;

    @ManyToOne(() => Users, { nullable: true })
    bodReviewedBy: Users;

    @Column({ type: "timestamptz", nullable: true })
    bodReviewedAt: Date;

    @Column({ type: "text", nullable: true })
    bodReviewNote: string;

    @OneToMany(() => ContractServices, (service) => service.addendum)
    services: ContractServices[];

    @OneToMany(() => PaymentMilestones, (milestone) => milestone.addendum)
    milestones: PaymentMilestones[];

    @ManyToOne(() => Quotations, { nullable: true })
    quotation: Quotations;
}
