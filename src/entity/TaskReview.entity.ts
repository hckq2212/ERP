import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Tasks } from "./Task.entity";
import { JobCriterias } from "./JobCriteria.entity";
import { Users } from "./User.entity";

@Entity()
export class TaskReviews extends BaseEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @ManyToOne(() => Tasks, (task) => task.reviews)
    task: Tasks;

    @ManyToOne(() => JobCriterias)
    criteria: JobCriterias;

    @Column({ nullable: true })
    reviewerId: number;

    @ManyToOne(() => Users, { nullable: true })
    @JoinColumn({ name: "reviewerId" })
    reviewer: Users;

    @Column({ default: false })
    isPassed: boolean;

    @Column({ type: "text", nullable: true })
    note: string;
}
