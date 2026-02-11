import { Entity, Column, ManyToOne, JoinColumn, OneToMany } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Projects } from "./Project.entity";
import { Jobs } from "./Job.entity";
import { Users } from "./User.entity";
import { ContractServices } from "./ContractService.entity";
import { Vendors } from "./Vendor.entity";
import { TaskReviews } from "./TaskReview.entity";
import { Services } from "./Service.entity";

export enum TaskStatus {
    PENDING = "PENDING",
    DOING = "DOING",
    DONE = "DONE",
    AWAITING_ACCEPTANCE = "AWAITING_ACCEPTANCE",
    COMPLETED = "COMPLETED",
    AWAITING_REVIEW = "AWAITING_REVIEW",
    REJECTED = "REJECTED",
    OVERDUE = "OVERDUE",
    AWAITING_PRICING = "AWAITING_PRICING"
}

export enum PricingStatus {
    PENDING = "PENDING",
    BILLABLE = "BILLABLE",
    NON_BILLABLE = "NON_BILLABLE"
}

@Entity()
export class Tasks extends BaseEntity {

    @Column({ nullable: true })
    code: string;

    @Column()
    name: string;

    @ManyToOne(() => Projects, (project) => project.tasks, { nullable: true })
    project: Projects;

    @ManyToOne(() => Jobs, (job) => job.tasks)
    job: Jobs;

    @ManyToOne(() => ContractServices, (contractService) => contractService.tasks, { nullable: true })
    contractService: ContractServices;

    @Column({ type: "varchar", length: 26, nullable: true })
    assigneeId: string;

    @ManyToOne(() => Users, (user) => user.tasks, { nullable: true })
    @JoinColumn({ name: "assigneeId" })
    assignee: Users;

    @Column({ type: "varchar", length: 26, nullable: true })
    assignerId: string;

    @ManyToOne(() => Users, { nullable: true })
    @JoinColumn({ name: "assignerId" })
    assigner: Users;

    @Column({
        type: "enum",
        enum: ["INTERNAL", "VENDOR"],
        default: "INTERNAL"
    })
    performerType: "INTERNAL" | "VENDOR";

    @ManyToOne(() => Vendors, { nullable: true })
    vendor: Vendors;

    @Column({
        type: "enum",
        enum: TaskStatus,
        default: TaskStatus.PENDING
    })
    status: TaskStatus;

    @Column({ type: "json", nullable: true })
    result: { type: string, name: string, url: string, size?: number, publicId?: string }; // Store JSON of result (file or link)

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

    @OneToMany(() => TaskReviews, (review) => review.task)
    reviews: TaskReviews[];

    @Column({ default: false })
    isExtra: boolean;

    @Column({
        type: "enum",
        enum: PricingStatus,
        nullable: true
    })
    pricingStatus: PricingStatus;

    @Column({ type: "decimal", precision: 15, scale: 2, default: 0 })
    sellingPrice: number;

    @Column({ type: "decimal", precision: 15, scale: 2, default: 0 })
    cost: number;

    @ManyToOne(() => Services)
    mappedService: Services;

    @ManyToOne("Quotations", "tasks", { nullable: true })
    quotation: any; // Using string and any to avoid circular dependency if not handled elsewhere
}
