import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from "typeorm";
import { BaseEntity } from "../../../shared/entities/BaseEntity";
import { Jobs } from "../../job/entities/Job.entity";
import { ServiceJob } from "../../service/entities/ServiceJob.entity";
import { Tasks } from "../../task/entities/Task.entity";
import { OpportunityServices } from "./OpportunityService.entity";

@Entity()
export class OpportunityServiceJobs extends BaseEntity {
    @Column({ type: "varchar", length: 26 })
    opportunityServiceId: string;

    @ManyToOne(() => OpportunityServices, (item) => item.jobs, { onDelete: "CASCADE" })
    @JoinColumn({ name: "opportunityServiceId" })
    opportunityService: OpportunityServices;

    @Column({ type: "varchar", length: 26, nullable: true })
    serviceJobId: string | null;

    @ManyToOne(() => ServiceJob, { nullable: true, onDelete: "SET NULL" })
    @JoinColumn({ name: "serviceJobId" })
    serviceJob: ServiceJob | null;

    @Column({ type: "varchar", length: 26 })
    jobId: string;

    @ManyToOne(() => Jobs)
    @JoinColumn({ name: "jobId" })
    job: Jobs;

    @Column()
    name: string;

    @Column({ type: "decimal", precision: 10, scale: 0, default: 1 })
    quantity: number;

    @Column({ type: "text", nullable: true })
    briefVideo: string | null;

    @Column({ type: "decimal", precision: 15, scale: 3, default: 0 })
    costAtSale: number;

    @Column({ default: false })
    isBriefVideo: boolean;

    @Column({ default: true })
    isQuotationItem: boolean;

    @OneToMany(() => Tasks, (task) => task.opportunityServiceJob)
    tasks: Tasks[];
}
