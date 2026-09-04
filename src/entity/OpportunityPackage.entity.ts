import { Entity, Column, ManyToOne, OneToMany, JoinColumn } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Opportunities } from "./Opportunity.entity";
import { ServicePackages } from "./ServicePackage.entity";
import { OpportunityServices } from "./OpportunityService.entity";

@Entity()
export class OpportunityPackages extends BaseEntity {

    @ManyToOne(() => Opportunities, (opp) => opp.packages)
    @JoinColumn({ name: "opportunityId" })
    opportunity: Opportunities;

    @Column({ type: "varchar", length: 26 })
    opportunityId: string;

    @ManyToOne(() => ServicePackages, (pkg) => pkg.opportunityPackages, { nullable: true })
    @JoinColumn({ name: "servicePackageId" })
    servicePackage: ServicePackages;

    @Column({ type: "varchar", length: 26, nullable: true })
    servicePackageId: string;

    @Column()
    name: string; // Snapshot of package name at time of sale

    @Column({ type: "text", nullable: true })
    description: string;

    @Column({ type: "int", default: 1 })
    quantity: number;

    @OneToMany(() => OpportunityServices, (oppService) => oppService.opportunityPackage)
    services: OpportunityServices[];
}
