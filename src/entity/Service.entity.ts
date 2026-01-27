import { Entity, PrimaryGeneratedColumn, Column, ManyToMany, JoinTable, OneToMany } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Jobs } from "./Job.entity";
import { OpportunityServices } from "./OpportunityService.entity";
import { ContractServices } from "./ContractService.entity";

@Entity()
export class Services extends BaseEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    name: string;

    @Column({ type: "decimal", precision: 15, scale: 2, default: 0 })
    costPrice: number;

    @ManyToMany(() => Jobs, (job) => job.services)
    @JoinTable({ name: "service_jobs" })
    jobs: Jobs[];

    @OneToMany(() => OpportunityServices, (oppService) => oppService.service)
    opportunityServices: OpportunityServices[];

    @OneToMany(() => ContractServices, (contractService) => contractService.service)
    contractServices: ContractServices[];
}
