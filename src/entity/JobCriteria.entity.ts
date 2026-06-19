import { Entity, Column, ManyToOne, DeleteDateColumn } from "typeorm";
import { TenantEntity } from "./TenantEntity";
import { Jobs } from "./Job.entity";

@Entity()
export class JobCriterias extends TenantEntity {

    @Column()
    name: string; // e.g., "Video đúng chủ đề", "Âm thanh rõ nét"

    @ManyToOne(() => Jobs, (job) => job.criteria)
    job: Jobs;

    @Column({ nullable: true })
    description: string;

    @DeleteDateColumn()
    deletedAt: Date;

}
