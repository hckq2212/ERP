import { Entity, Column, ManyToOne, JoinColumn, PrimaryColumn } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Services } from "./Service.entity";
import { Jobs } from "./Job.entity";

@Entity()
export class ServiceJob extends BaseEntity {

    @ManyToOne(() => Services, (service) => service.serviceJobs, { onDelete: "CASCADE" })
    @JoinColumn({ name: "serviceId" })
    service: Services;

    @Column({ type: "varchar", length: 26 })
    serviceId: string;

    @ManyToOne(() => Jobs, (job) => job.serviceJobs)
    @JoinColumn({ name: "jobId" })
    job: Jobs;

    @Column({ type: "varchar", length: 26 })
    jobId: string;

    @Column({ type: "decimal", precision: 10, scale: 0, default: 1 })
    quantity: number;

    @Column({ default: false })
    isOutput: boolean;
}
