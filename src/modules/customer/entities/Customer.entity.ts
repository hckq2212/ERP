import { Entity, Column, ManyToOne, OneToMany } from "typeorm";
import { BaseEntity } from "../../../shared/entities/BaseEntity";
import { ReferralPartners } from "../../referral-partner/entities/ReferralPartner.entity";
import { Contracts } from "../../contract/entities/Contract.entity";
import { Opportunities } from "../../opportunity/entities/Opportunity.entity";
import { Users } from "../../user/entities/User.entity";

export enum CustomerSource {
    INTERNAL = "INTERNAL",
    REFERRAL_PARTNER = "REFERRAL_PARTNER"
}

@Entity()
export class Customers extends BaseEntity {

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
