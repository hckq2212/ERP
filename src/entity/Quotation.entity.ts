import { Entity, Column, ManyToOne, OneToMany } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Opportunities } from "./Opportunity.entity";
import { QuotationDetails } from "./QuotationDetail.entity";
import { Tasks } from "./Task.entity";

export enum QuotationStatus {
    DRAFT = "DRAFT",
    PENDING_APPROVAL = "PENDING_APPROVAL", // Chờ BOD duyệt
    APPROVED = "APPROVED", // Đã duyệt (Official)
    REJECTED = "REJECTED",
    ARCHIVED = "ARCHIVED"
}

export enum QuotationType {
    INITIAL = "INITIAL",
    ADDENDUM = "ADDENDUM"
}

@Entity()
export class Quotations extends BaseEntity {

    @Column({ type: "text", nullable: true })
    note: string;

    @Column({ type: "int", default: 1 })
    version: number;

    @Column({
        type: "enum",
        enum: QuotationStatus,
        default: QuotationStatus.DRAFT
    })
    status: QuotationStatus;

    @Column({
        type: "enum",
        enum: QuotationType,
        default: QuotationType.INITIAL
    })
    type: QuotationType;

    @Column({ type: "decimal", precision: 15, scale: 2, default: 0 })
    totalAmount: number;

    @ManyToOne(() => Opportunities, (opportunity) => opportunity.quotations)
    opportunity: Opportunities;

    @OneToMany(() => QuotationDetails, (detail) => detail.quotation)
    details: QuotationDetails[];

    @OneToMany(() => Tasks, (task) => task.quotation, { nullable: true })
    tasks: Tasks[];
}
