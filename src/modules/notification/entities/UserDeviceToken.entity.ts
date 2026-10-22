import { Entity, Column, ManyToOne, Relation, Index } from "typeorm";
import { BaseEntity } from "../../../shared/entities/BaseEntity";
import { Users } from "../../user/entities/User.entity";

@Entity("user_device_tokens")
@Index(["userId", "deviceId"], { unique: true })
export class UserDeviceTokens extends BaseEntity {

    @Index()
    @Column()
    userId: string;

    @ManyToOne(() => Users, { onDelete: "CASCADE" })
    user: Relation<Users>;

    @Index()
    @Column({ unique: true })
    token: string;

    @Column()
    deviceId: string;

    @Column({ default: "android" })
    platform: string;

    @Column({ nullable: true })
    deviceName: string;

    @Column({ type: "timestamp", default: () => "CURRENT_TIMESTAMP" })
    lastActiveAt: Date;
}
