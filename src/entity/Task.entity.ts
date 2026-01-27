import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Projects } from "./Project.entity";
import { Jobs } from "./Job.entity";
import { Users } from "./User.entity";
import { ContractServices } from "./ContractService.entity";

export enum TaskStatus {
    PENDING = "PENDING",
    DOING = "DOING",
    DONE = "DONE",
    AWAITING_ACCEPTANCE = "AWAITING_ACCEPTANCE",
    COMPLETED = "COMPLETED"
}

@Entity()
export class Tasks extends BaseEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    name: string;

    @ManyToOne(() => Projects, (project) => project.tasks)
    project: Projects;

    @ManyToOne(() => Jobs, (job) => job.tasks)
    job: Jobs;

    @ManyToOne(() => ContractServices, (contractService) => contractService.tasks)
    contractService: ContractServices;

    @ManyToOne(() => Users, (user) => user.tasks)
    assignee: Users;

    @Column({
        type: "enum",
        enum: TaskStatus,
        default: TaskStatus.PENDING
    })
    status: TaskStatus;

    @Column({ type: "text", nullable: true })
    resultFiles: string; // Store JSON array of Cloudinary URLs

    @Column({ type: "date", nullable: true })
    plannedStartDate: Date;

    @Column({ type: "date", nullable: true })
    plannedEndDate: Date;

    @Column({ type: "date", nullable: true })
    actualStartDate: Date;

    @Column({ type: "date", nullable: true })
    actualEndDate: Date;
}
