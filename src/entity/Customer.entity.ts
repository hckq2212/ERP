import { Entity, Column, ManyToOne, OneToMany } from "typeorm";
import { TenantEntity } from "./TenantEntity";
import { ReferralPartners } from "./ReferralPartner.entity";
import { Contracts } from "./Contract.entity";
import { Opportunities } from "./Opportunity.entity";
import { Users } from "./User.entity";

export enum CustomerSource {
    INTERNAL = "INTERNAL",
    REFERRAL_PARTNER = "REFERRAL_PARTNER"
}

@Entity()
export class Customers extends TenantEntity {

    @Column()
    name: string;

    @Column()
    phone: string;

    @Column()
    email: string;

    @Column()
    address: string;

    @Column({ nullable: true })
    taxId: string;

    @Column({
        type: "enum",
        enum: CustomerSource,
        default: CustomerSource.INTERNAL
    })
    source: CustomerSource;

    @ManyToOne(() => ReferralPartners, (referralPartner) => referralPartner.customers)
    referralPartner: ReferralPartners;

    @OneToMany(() => Contracts, (contract) => contract.customer)
    contracts: Contracts[];

    @OneToMany(() => Opportunities, (opportunity) => opportunity.customer)
    opportunities: Opportunities[];

    @ManyToOne(() => Users)
    createdBy: Users;
}
