import { Entity, Column, ManyToOne } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Quotations } from "./Quotation.entity";
import { Services } from "./Service.entity";

@Entity()
export class QuotationDetails extends BaseEntity {

    @ManyToOne(() => Quotations, (quotation) => quotation.details, { onDelete: 'CASCADE' })
    quotation: Quotations;

    @ManyToOne(() => Services)
    service: Services;

    @Column({ type: "int", default: 1 })
    quantity: number;

    @Column({ type: "decimal", precision: 15, scale: 2, default: 0 })
    sellingPrice: number; // Proposed selling price per unit

    @Column({ type: "decimal", precision: 15, scale: 2, default: 0 })
    costAtSale: number; // Estimated cost per unit (for margin calc)
}
