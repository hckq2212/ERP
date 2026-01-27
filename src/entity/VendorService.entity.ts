import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Vendors } from "./Vendor.entity";
import { Services } from "./Service.entity";

@Entity()
export class VendorServices extends BaseEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @ManyToOne(() => Vendors, (vendor) => vendor.id)
    vendor: Vendors;

    @ManyToOne(() => Services, (service) => service.id)
    service: Services;

    @Column({ type: "decimal", precision: 15, scale: 2, default: 0 })
    price: number;

    @Column({ default: "VND" })
    currency: string;

    @Column({ type: "text", nullable: true })
    note: string;
}
