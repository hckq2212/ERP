import { Entity, Column, ManyToOne, JoinColumn } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Tasks } from "./Task.entity";
import { JobCriterias } from "./JobCriteria.entity";
import { Users } from "./User.entity";

export enum ReviewerType {
    TEAM_LEAD = "TEAM_LEAD",
    ASSIGNER = "ASSIGNER"
}

@Entity()
export class TaskReviews extends BaseEntity {

    @Column({
        type: "enum",
        enum: ReviewerType,
        default: ReviewerType.ASSIGNER
    })
    reviewerType: ReviewerType;

    @ManyToOne(() => Tasks, (task) => task.reviews)
    task: Tasks;

    @ManyToOne(() => JobCriterias)
    criteria: JobCriterias;

    @Column({ type: "varchar", length: 26, nullable: true })
    reviewerId: string;

    @ManyToOne(() => Users, { nullable: true })
    @JoinColumn({ name: "reviewerId" })
    reviewer: Users;

    @Column({ default: false })
    isPassed: boolean;

    @Column({ type: "text", nullable: true })
    note: string;
}
