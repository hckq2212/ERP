import { Column, Entity, Index, OneToMany } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { CompanyMembers } from "./CompanyMember.entity";

@Entity()
export class Companies extends BaseEntity {
    @Column()
    name: string;

    @Index({ unique: true })
    @Column()
    slug: string;

    @Index({ unique: true })
    @Column({ nullable: true })
    subdomain: string;

    @OneToMany(() => CompanyMembers, (member) => member.company)
    members: CompanyMembers[];
}
