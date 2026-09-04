import { Entity, Column, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Users } from "./User.entity";

export enum UserRole {
    BOD = "BOD",
    ADMIN = "ADMIN",
    ADMIN_SALE = "ADMIN_SALE",
    BD = "BD",
    PM = "PM",
    STAFF_A = "STAFF_A",
    STAFF_B = "STAFF_B",
    STAFF_C = "STAFF_C",
    STAFF_D = "STAFF_D",
}

export const STAFF_ROLES = [
    UserRole.STAFF_A,
    UserRole.STAFF_B,
    UserRole.STAFF_C,
    UserRole.STAFF_D,
];

export const MANAGEMENT_ROLES = [
    UserRole.BOD,
    UserRole.ADMIN,
];

export const SALES_ROLES = [
    UserRole.BD,
    UserRole.ADMIN_SALE,
];

export const PROJECT_MANAGEMENT_ROLES = [
    UserRole.BOD,
    UserRole.ADMIN,
    UserRole.PM,
];

export const isStaffRole = (role?: string): role is UserRole => STAFF_ROLES.includes(role as UserRole);
export const isManagementRole = (role?: string): role is UserRole => MANAGEMENT_ROLES.includes(role as UserRole);
export const isProjectManagementRole = (role?: string): role is UserRole => PROJECT_MANAGEMENT_ROLES.includes(role as UserRole);

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
        default: UserRole.STAFF_D
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
