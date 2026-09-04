import { Entity, Column, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Users } from "./User.entity";

export enum UserRole {
    SALE = "SALE",
    BOD = "BOD",
    MEMBER = "MEMBER",
    ADMIN = "ADMIN",
    ACCOUNTANT = "ACCOUNTANT",
    ADMIN_SALE = "ADMIN_SALE",
    BD = "BD",
    HR = "HR",
}

@Entity()
@Index(["username"], { unique: true })
@Index(["email"], { unique: true })
export class Accounts extends BaseEntity {

    @Column()
    username: string;

    @Column()
    password: string;

    @Column({ nullable: true })
    email: string;

    @Column({
        type: "enum",
        enum: UserRole,
        default: UserRole.MEMBER
    })
    role: UserRole;

    @Column({ default: true })
    isActive: boolean;

    @Column({ default: 0 })
    vinicoin: number;

    @Column({ default: 0 })
    vinicoinTotal: number;

    @Column({ default: 0 })
    vinicoinWithdrawn: number;

    @ManyToOne(() => Users, (user) => user.accounts, { onDelete: "CASCADE" })
    @JoinColumn({ name: "userId" })
    user: Users;

    @Column({ type: "varchar", length: 26, nullable: true })
    userId: string;

}
