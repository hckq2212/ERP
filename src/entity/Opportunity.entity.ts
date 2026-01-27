import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Customers } from "./Customer.entity";
import { Quotations } from "./Quotation.entity";
import { OpportunityServices } from "./OpportunityService.entity";
import { Contracts } from "./Contract.entity";
import { ReferralPartners } from "./ReferralPartner.entity";

export enum Region {
    NATIONAL = "TOÀN QUỐC",
    NORTH = "BẮC",
    CENTRAL = "TRUNG",
    SOUTH = "NAM"
}

export enum CustomerType {
    DIRECT = "DIRECT", // Khách hàng trực tiếp
    REFERRAL = "REFERRAL" // Khách hàng liên kết
}

export enum OpportunityStatus {
    OPEN = "OPEN", // Mới tạo
    PENDING_OPP_APPROVAL = "PENDING_OPP_APPROVAL", // Chờ BOD duyệt cơ hội
    OPP_APPROVED = "OPP_APPROVED", // Đã duyệt cơ hội
    QUOTATION_DRAFTING = "QUOTATION_DRAFTING", // Làm báo giá
    PENDING_QUOTE_APPROVAL = "PENDING_QUOTE_APPROVAL", // Chờ duyệt báo giá
    QUOTE_APPROVED = "QUOTE_APPROVED", // Báo giá đã duyệt
    CONTRACT_CREATED = "CONTRACT_CREATED", // Đã tạo hợp đồng
    PROJECT_ASSIGNED = "PROJECT_ASSIGNED", // Đã phân công dự án
    IMPLEMENTATION = "IMPLEMENTATION", // Đang thực hiện
    COMPLETED = "COMPLETED",
    CANCELLED = "CANCELLED"
}

@Entity()
export class Opportunities extends BaseEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ unique: true })
    opportunityCode: string;

    @Column()
    name: string;

    @Column({ type: "text", nullable: true })
    description: string;

    @Column()
    field: string;

    @Column({ type: "decimal", precision: 15, scale: 2, default: 0 })
    expectedRevenue: number;

    @Column({ type: "decimal", precision: 15, scale: 2, default: 0 })
    budget: number;

    @Column({ type: "date", nullable: true })
    startDate: Date;

    @Column({ type: "date", nullable: true })
    endDate: Date;

    @Column()
    priority: string;

    @Column({ type: "int", default: 0 })
    successChance: number;

    @Column({
        type: "enum",
        enum: Region,
        default: Region.NATIONAL
    })
    region: Region;

    @Column({ type: "int", default: 0 })
    durationMonths: number;

    @Column({
        type: "enum",
        enum: OpportunityStatus,
        default: OpportunityStatus.OPEN
    })
    status: OpportunityStatus;

    // Customer Type info
    @Column({
        type: "enum",
        enum: CustomerType,
        default: CustomerType.DIRECT
    })
    customerType: CustomerType;

    // Lead Information (for Potential Customers)
    @Column({ nullable: true })
    leadName: string;

    @Column({ nullable: true })
    leadPhone: string;

    @Column({ nullable: true })
    leadEmail: string;

    @Column({ nullable: true })
    leadAddress: string;

    @Column({ nullable: true })
    leadTaxId: string;

    // Relations
    @ManyToOne(() => Customers, (customer) => customer.opportunities, { nullable: true })
    customer: Customers;

    @ManyToOne(() => ReferralPartners, (partner) => partner.opportunities, { nullable: true })
    referralPartner: ReferralPartners;

    @OneToMany(() => Quotations, (quotation) => quotation.opportunity)
    quotations: Quotations[];

    @OneToMany(() => OpportunityServices, (oppService) => oppService.opportunity)
    services: OpportunityServices[];

    @OneToMany(() => Contracts, (contract) => contract.opportunity)
    contracts: Contracts[];
}
