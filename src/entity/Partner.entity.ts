import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Jobs } from "./Job.entity";

export enum PartnerType {
    INDIVIDUAL = "INDIVIDUAL",
    BUSINESS = "BUSINESS"
}

@Entity()
export class Partners extends BaseEntity {
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

    @OneToMany(() => Jobs, (job) => job.partner)
    jobs: Jobs[];
}
