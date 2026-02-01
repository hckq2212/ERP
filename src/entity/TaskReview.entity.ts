import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Tasks } from "./Task.entity";
import { JobCriterias } from "./JobCriteria.entity";

@Entity()
export class TaskReviews extends BaseEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @ManyToOne(() => Tasks, (task) => task.reviews)
    task: Tasks;

    @ManyToOne(() => JobCriterias)
    criteria: JobCriterias;

    @Column({ default: false })
    isPassed: boolean;

    @Column({ type: "text", nullable: true })
    note: string;
}
