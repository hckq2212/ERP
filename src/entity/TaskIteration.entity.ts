import { Entity, Column, ManyToOne, JoinColumn } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Tasks } from "./Task.entity";

@Entity()
export class TaskIterations extends BaseEntity {

    @ManyToOne(() => Tasks, (task) => task.iterations)
    @JoinColumn({ name: "taskId" })
    task: Tasks;

    @Column({ type: "varchar", length: 26 })
    taskId: string;

    @Column({ type: "int" })
    version: number;

    @Column({ type: "json", nullable: true })
    submittedResult: any;

    @Column({ type: "text", nullable: true })
    leadFeedback: string;

    @Column({ type: "json", nullable: true })
    feedbackAttachments: { type: string, name: string, url: string, size?: number, publicId?: string }[];

    @Column({ type: "date", nullable: true })
    deadlineAt: Date;
}
