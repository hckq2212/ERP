import { Entity, PrimaryGeneratedColumn, Column, OneToOne } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Users } from "./User.entity";

export enum UserRole {
    SALE = "SALE",
    BOD = "BOD",
    TEAM_LEAD = "TEAM_LEAD",
    MEMBER = "MEMBER",
    ADMIN = "ADMIN"
}

@Entity()
export class Accounts extends BaseEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ unique: true })
    username: string;

    @Column()
    password: string;

    @Column({ unique: true })
    email: string;

    @Column({
        type: "enum",
        enum: UserRole,
        default: UserRole.MEMBER
    })
    role: UserRole;

    @Column({ default: true })
    isActive: boolean;

    @OneToOne(() => Users, (user) => user.account)
    user: Users;
}
