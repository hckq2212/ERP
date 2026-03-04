import { Entity, Column, ManyToOne, JoinColumn } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Quotations } from "./Quotation.entity";
import { Services } from "./Service.entity";
import { Jobs } from "./Job.entity";

@Entity()
export class QuotationDetails extends BaseEntity {

    @ManyToOne(() => Quotations, (quotation) => quotation.details, { onDelete: 'CASCADE' })
    quotation: Quotations;

    @ManyToOne(() => Services, { nullable: true })
    @JoinColumn({ name: "serviceId" })
    service: Services;

    @Column({ type: "varchar", length: 26, nullable: true })
    serviceId: string;

    @ManyToOne(() => Jobs, { nullable: true })
    job: Jobs;

    @Column({ type: "int", default: 1 })
    quantity: number;

    @Column({ type: "decimal", precision: 15, scale: 2, default: 0 })
    sellingPrice: number; // Proposed selling price per unit

    @Column({ type: "decimal", precision: 15, scale: 2, default: 0 })
    costAtSale: number; // Estimated cost per unit (for margin calc)

    @Column({ nullable: true })
    name: string; // Snapshot of service name

    @Column({ type: "int", default: 1, nullable: true })
    packageQuantity: number; // Quantity of the package this item belongs to

    @Column({ nullable: true })
    packageName: string;

    @Column({ nullable: true })
    servicePackageId: string;

    @Column({ default: false })
    isPackageService: boolean;
}
