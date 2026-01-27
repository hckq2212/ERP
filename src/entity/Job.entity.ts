import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, ManyToMany, OneToMany } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Partners } from "./Partner.entity";
import { Services } from "./Service.entity";
import { Tasks } from "./Task.entity";

export enum PerformerType {
    PARTNER = "PARTNER",
    INTERNAL = "INTERNAL"
}

@Entity()
export class Jobs extends BaseEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    name: string;

    @Column({ type: "decimal", precision: 15, scale: 2, default: 0 })
    costPrice: number;

    @Column({
        type: "enum",
        enum: PerformerType,
        default: PerformerType.INTERNAL
    })
    performerType: PerformerType;

    @ManyToOne(() => Partners, (partner) => partner.jobs, { nullable: true })
    partner: Partners;

    @Column({ nullable: true })
    code: string;

    @ManyToMany(() => Services, (service) => service.jobs)
    services: Services[];

    @OneToMany(() => Tasks, (task) => task.job)
    tasks: Tasks[];
}
