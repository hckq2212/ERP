import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Companies } from "./Company.entity";
import { Users } from "./User.entity";

export enum CompanyMemberRole {
    OWNER = "owner",
    ADMIN = "admin",
    MEMBER = "member",
}

@Entity()
@Index(["company", "user"], { unique: true })
export class CompanyMembers extends BaseEntity {
    @ManyToOne(() => Companies, (company) => company.members, { onDelete: "CASCADE" })
    @JoinColumn({ name: "companyId" })
    company: Companies;

    @Column({ type: "varchar", length: 26 })
    companyId: string;

    @ManyToOne(() => Users, (user) => user.companyMemberships, { onDelete: "CASCADE" })
    @JoinColumn({ name: "userId" })
    user: Users;

    @Column({ type: "varchar", length: 26 })
    userId: string;

    @Column({
        type: "enum",
        enum: CompanyMemberRole,
        default: CompanyMemberRole.MEMBER
    })
    role: CompanyMemberRole;
}
