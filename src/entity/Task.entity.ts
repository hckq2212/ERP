import { Entity, Column, ManyToOne, JoinColumn, OneToMany } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Projects } from "./Project.entity";
import { Jobs } from "./Job.entity";
import { Users } from "./User.entity";
import { ContractServices } from "./ContractService.entity";
import { Vendors } from "./Vendor.entity";
import { TaskReviews } from "./TaskReview.entity";
import { Services } from "./Service.entity";
import { TaskIterations } from "./TaskIteration.entity";
import { TaskStatus, PerformerType, PricingStatus } from "./Enums";


@Entity()
export class Tasks extends BaseEntity {

    @Column({ nullable: true })
    code: string;

    @Column()
    name: string;

    @ManyToOne(() => Projects, (project) => project.tasks, { nullable: true })
    project: Projects;

    @ManyToOne(() => Jobs, (job) => job.tasks, { nullable: true })
    job: Jobs;

    @ManyToOne(() => ContractServices, (contractService) => contractService.tasks, { nullable: true })
    contractService: ContractServices;

    @Column({ type: "varchar", length: 26, nullable: true })
    assigneeId: string;

    @ManyToOne(() => Users, (user) => user.tasks, { nullable: true })
    @JoinColumn({ name: "assigneeId" })
    assignee: Users;

    @Column({ type: "varchar", length: 26, nullable: true })
    supervisorId: string;

    @ManyToOne(() => Users, { nullable: true })
    @JoinColumn({ name: "supervisorId" })
    supervisor: Users;

    @Column({ type: "varchar", length: 26, nullable: true })
    assignerId: string;

    @ManyToOne(() => Users, { nullable: true })
    @JoinColumn({ name: "assignerId" })
    assigner: Users;

    @Column({
        type: "enum",
        enum: PerformerType,
        default: PerformerType.INTERNAL
    })
    performerType: PerformerType;

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

    @Column({ type: "timestamptz", nullable: true })
    plannedStartDate: Date;

    @Column({ type: "timestamptz", nullable: true })
    plannedEndDate: Date;

    @Column({ type: "timestamptz", nullable: true })
    actualStartDate: Date;

    @Column({ type: "timestamptz", nullable: true })
    actualEndDate: Date;

    @Column({ type: "text", nullable: true })
    description: string;

    @Column({ type: "json", nullable: true })
    attachments: { type: string, name: string, url: string, size?: number, publicId?: string }[];

    @OneToMany(() => TaskReviews, (review) => review.task)
    reviews: TaskReviews[];

    @OneToMany(() => TaskIterations, (iteration) => iteration.task)
    iterations: TaskIterations[];

    @Column({ default: false })
    isExtra: boolean;

    @Column({ default: false })
    isOutput: boolean;

    @Column({
        type: "enum",
        enum: PricingStatus,
        nullable: true
    })
    pricingStatus: PricingStatus;

    @Column({ type: "decimal", precision: 15, scale: 3, default: 0 })
    sellingPrice: number;

    @Column({ type: "decimal", precision: 15, scale: 3, default: 0 })
    cost: number;

    @ManyToOne(() => Services)
    mappedService: Services;

    @ManyToOne("Quotations", "tasks", { nullable: true })
    quotation: any;

    @Column({ type: "text", nullable: true })
    reviewNote: string; // Persistent rejection reason

    @Column({ type: "text", nullable: true })
    reassignNote: string; // Reason for reassignment

    @Column({ default: false })
    isSupportRequested: boolean;

    @Column({ default: false })
    isSupportAccepted: boolean;

    @Column({ type: "varchar", length: 26, nullable: true })
    supportTeamId: string;

    @Column({ type: "varchar", length: 26, nullable: true })
    supportLeadId: string;

    @Column({ type: "varchar", length: 26, nullable: true })
    helperId: string;

    @ManyToOne(() => Users, { nullable: true })
    @JoinColumn({ name: "helperId" })
    helper: Users;

    @Column({ type: "text", nullable: true })
    supportRequestNote: string;
}
