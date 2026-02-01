import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Jobs } from "./Job.entity";

@Entity()
export class JobCriterias extends BaseEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    name: string; // e.g., "Video đúng chủ đề", "Âm thanh rõ nét"

    @ManyToOne(() => Jobs, (job) => job.criteria)
    job: Jobs;
}
