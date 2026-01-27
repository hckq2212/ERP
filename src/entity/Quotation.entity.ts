import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Opportunities } from "./Opportunity.entity";

export enum QuotationStatus {
    ACTIVE = "ACTIVE",
    ARCHIVED = "ARCHIVED",
    REJECTED = "REJECTED"
}

@Entity()
export class Quotations extends BaseEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: "text", nullable: true })
    note: string;

    @Column({ type: "int", default: 1 })
    version: number;

    @Column({
        type: "enum",
        enum: QuotationStatus,
        default: QuotationStatus.ACTIVE
    })
    status: QuotationStatus;

    @ManyToOne(() => Opportunities, (opportunity) => opportunity.quotations)
    opportunity: Opportunities;
}
