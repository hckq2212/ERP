import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { PartnerType } from "./Partner.entity";
import { Customers } from "./Customer.entity";

@Entity()
export class PartnerLinks extends BaseEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    name: string;

    @Column({ nullable: true })
    taxId: string;

    @Column()
    phone: string;

    @Column()
    address: string;

    @Column()
    email: string;

    @Column({
        type: "enum",
        enum: PartnerType,
        default: PartnerType.BUSINESS
    })
    type: PartnerType;

    @OneToMany(() => Customers, (customer) => customer.partnerLink)
    customers: Customers[];
}
