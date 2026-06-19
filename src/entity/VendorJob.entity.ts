import { Entity, Column, ManyToOne } from "typeorm";
import { TenantEntity } from "./TenantEntity";
import { Vendors } from "./Vendor.entity";
import { Jobs } from "./Job.entity";

@Entity()
export class VendorJobs extends TenantEntity {

    @ManyToOne(() => Vendors, (vendor) => vendor.vendorJobs)
    vendor: Vendors;

    @ManyToOne(() => Jobs, (job) => job.vendorJobs)
    job: Jobs;

    @Column({ type: "decimal", precision: 15, scale: 3, default: 0 })
    price: number;

    @Column({ type: "text", nullable: true })
    note: string;
}
