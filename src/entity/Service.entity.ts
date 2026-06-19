import { Entity, Column, OneToMany } from "typeorm";
import { TenantEntity } from "./TenantEntity";
import { OpportunityServices } from "./OpportunityService.entity";
import { ContractServices } from "./ContractService.entity";
import { ServiceJob } from "./ServiceJob.entity";

@Entity()
export class Services extends TenantEntity {

    @Column()
    name: string;

    @Column({ nullable: true })
    description: string;

    @Column({ nullable: true })
    unit: string;

    @Column({ type: "decimal", precision: 15, scale: 3, default: 0 })
    costPrice: number;

    @Column({ type: "decimal", precision: 15, scale: 3, default: 0 })
    overheadCost: number;

    @OneToMany(() => ServiceJob, (serviceJob) => serviceJob.service, { cascade: true })
    serviceJobs: ServiceJob[];

    @OneToMany(() => OpportunityServices, (oppService) => oppService.service)
    opportunityServices: OpportunityServices[];

    @OneToMany(() => ContractServices, (contractService) => contractService.service)
    contractServices: ContractServices[];
}
