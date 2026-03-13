import { Entity, Column, ManyToOne, OneToMany, JoinColumn } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Services } from "./Service.entity";
import { Jobs } from "./Job.entity";
import { Contracts } from "./Contract.entity";
import { OpportunityServices } from "./OpportunityService.entity";
import { Tasks } from "./Task.entity";
import { ContractAddendums } from "./ContractAddendum.entity";

export enum ContractServiceStatus {
    ACTIVE = "ACTIVE",
    ACCEPTANCE_REJECTED = "ACCEPTANCE_REJECTED",
    CANCELLED = "CANCELLED",
    AWAITING_ACCEPTANCE = "AWAITING_ACCEPTANCE",
    COMPLETED = "COMPLETED"
}

@Entity()
export class ContractServices extends BaseEntity {

    @ManyToOne(() => Services, (service) => service.contractServices, { nullable: true })
    @JoinColumn({ name: "serviceId" })
    service: Services;

    @Column({ type: "varchar", length: 26, nullable: true })
    serviceId: string;

    @ManyToOne(() => Jobs, { nullable: true })
    job: Jobs;

    @ManyToOne(() => Contracts, (contract) => contract.services)
    contract: Contracts;

    @Column({ type: "decimal", precision: 15, scale: 2, default: 0 })
    sellingPrice: number;

    @ManyToOne(() => OpportunityServices, (oppService) => oppService.contractServices, { nullable: true })
    opportunityService: OpportunityServices;

    @OneToMany(() => Tasks, (task) => task.contractService)
    tasks: Tasks[];

    @Column({ type: "varchar", length: 26, nullable: true })
    outputTaskId: string;

    @ManyToOne(() => Tasks, { nullable: true })
    @JoinColumn({ name: "outputTaskId" })
    outputTask: Tasks;

    @ManyToOne(() => ContractAddendums, (addendum) => addendum.services, { nullable: true })
    addendum: ContractAddendums;

    @Column({
        type: "enum",
        enum: ContractServiceStatus,
        default: ContractServiceStatus.ACTIVE
    })
    status: ContractServiceStatus;

    @ManyToOne("AcceptanceRequests", "services", { nullable: true })
    acceptanceRequest: any;

    @Column({ type: "jsonb", nullable: true, default: [] })
    results: { taskId: string, type: string, name: string, url: string, status: 'PENDING' | 'APPROVED' | 'REJECTED', feedback?: string }[];

    @Column({ nullable: true })
    name: string; // Snapshot of service name

    @Column({ nullable: true })
    packageName: string; // Snapshot of package name

    @Column({ default: false })
    isPackageService: boolean;

    @Column({ type: "text", nullable: true })
    feedback: string;
}
