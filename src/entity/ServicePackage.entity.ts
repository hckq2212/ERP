import { Entity, Column, OneToMany } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { ServicePackageItems } from "./ServicePackageItem.entity";
import { OpportunityPackages } from "./OpportunityPackage.entity";

@Entity()
export class ServicePackages extends BaseEntity {

    @Column()
    name: string;

    @Column({ type: "text", nullable: true })
    description: string;

    @Column({ type: "boolean", default: true })
    isActive: boolean;

    @OneToMany(() => ServicePackageItems, (item) => item.package, { cascade: true })
    items: ServicePackageItems[];

    @OneToMany(() => OpportunityPackages, (oppPackage) => oppPackage.servicePackage)
    opportunityPackages: OpportunityPackages[];

    @Column({ type: "decimal", precision: 15, scale: 3, default: 0 })
    price: number;
}
