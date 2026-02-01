import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, ManyToMany, OneToMany } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Vendors } from "./Vendor.entity";
import { Services } from "./Service.entity";
import { Tasks } from "./Task.entity";
import { VendorJobs } from "./VendorJob.entity";
import { JobCriterias } from "./JobCriteria.entity";

export enum PerformerType {
    VENDOR = "VENDOR",
    INTERNAL = "INTERNAL"
}

@Entity()
export class Jobs extends BaseEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    name: string;

    @Column({ type: "decimal", precision: 15, scale: 2, default: 0 })
    costPrice: number;

    @Column({
        type: "enum",
        enum: PerformerType,
        default: PerformerType.INTERNAL
    })
    defaultPerformerType: PerformerType;

    @OneToMany(() => VendorJobs, (vendorJob) => vendorJob.job)
    vendorJobs: VendorJobs[];

    @Column({ nullable: true })
    code: string;

    @ManyToMany(() => Services, (service) => service.jobs)
    services: Services[];

    @OneToMany(() => Tasks, (task) => task.job)
    tasks: Tasks[];

    @OneToMany(() => JobCriterias, (criteria) => criteria.job, { cascade: true })
    criteria: JobCriterias[];
}
