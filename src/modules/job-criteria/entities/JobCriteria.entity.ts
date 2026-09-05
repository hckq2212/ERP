import { Entity, Column, ManyToOne, DeleteDateColumn } from "typeorm";
import { BaseEntity } from "../../../shared/entities/BaseEntity";
import { Jobs } from "../../job/entities/Job.entity";

@Entity()
export class JobCriterias extends BaseEntity {

    @Column()
    name: string; // e.g., "Video đúng chủ đề", "Âm thanh rõ nét"

    @ManyToOne(() => Jobs, (job) => job.criteria)
    job: Jobs;

    @Column({ nullable: true })
    description: string;

    @DeleteDateColumn()
    deletedAt: Date;

}
