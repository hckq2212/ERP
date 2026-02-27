import { Entity, Column, OneToMany } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Jobs } from "./Job.entity";
import { VendorJobs } from "./VendorJob.entity";

export enum PartnerType {
    INDIVIDUAL = "INDIVIDUAL",
    BUSINESS = "BUSINESS"
}

@Entity()
export class Vendors extends BaseEntity {

    @Column()
    name: string;

    @Column({ nullable: true })
    taxId: string;

    @Column()
    phone: string;

    @Column()
    address: string;

    @Column()
    email: string;

    @Column({
        type: "enum",
        enum: PartnerType,
        default: PartnerType.BUSINESS
    })
    type: PartnerType;

    @Column({ nullable: true })
    bankAccount: string;

    @Column({ nullable: true })
    idCardFront: string;

    @Column({ nullable: true })
    idCardBack: string;

    @OneToMany(() => VendorJobs, (vendorJob) => vendorJob.vendor)
    vendorJobs: VendorJobs[];
}
