import { Entity, Column, ManyToOne } from "typeorm";
import { BaseEntity } from "../../../shared/entities/BaseEntity";
import { Vendors } from "./Vendor.entity";
import { Jobs } from "../../job/entities/Job.entity";

@Entity()
export class VendorJobs extends BaseEntity {

    @ManyToOne(() => Vendors, (vendor) => vendor.vendorJobs)
    vendor: Vendors;

    @ManyToOne(() => Jobs, (job) => job.vendorJobs)
    job: Jobs;

    @Column({ type: "decimal", precision: 15, scale: 3, default: 0 })
    price: number;

    @Column({ type: "text", nullable: true })
    note: string;
}
