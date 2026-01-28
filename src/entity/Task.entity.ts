import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Projects } from "./Project.entity";
import { Jobs } from "./Job.entity";
import { Users } from "./User.entity";
import { ContractServices } from "./ContractService.entity";
import { Vendors } from "./Vendor.entity";

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
    code: string;

    @Column()
    name: string;

    @ManyToOne(() => Projects, (project) => project.tasks)
    project: Projects;

    @ManyToOne(() => Jobs, (job) => job.tasks)
    job: Jobs;

    @ManyToOne(() => ContractServices, (contractService) => contractService.tasks)
    contractService: ContractServices;

    @ManyToOne(() => Users, (user) => user.tasks, { nullable: true })
    assignee: Users;

    @Column({
        type: "enum",
        enum: ["INTERNAL", "VENTURE"],
        default: "INTERNAL"
    })
    performerType: "INTERNAL" | "VENTURE";

    @ManyToOne(() => Vendors, { nullable: true })
    vendor: Vendors;

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

    @Column({ type: "text", nullable: true })
    description: string;

    @Column({ type: "json", nullable: true })
    attachments: { type: string, name: string, url: string, size?: number, publicId?: string }[];

}
