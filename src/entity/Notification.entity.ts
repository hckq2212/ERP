import { Entity, Column, ManyToOne, Relation } from "typeorm"
import { TenantEntity } from "./TenantEntity"
import { Users } from "./User.entity"

@Entity()
export class Notifications extends TenantEntity {

    @Column()
    title: string

    @Column({ type: "text" })
    content: string

    @Column()
    type: string

    @Column({ default: false })
    isRead: boolean

    @Column({ type: "timestamp", nullable: true })
    readAt: Date

    @Column({ nullable: true })
    link: string

    @Column({ nullable: true })
    relatedEntityId: string

    @Column({ nullable: true })
    relatedEntityType: string

    @ManyToOne(() => Users)
    recipient: Relation<Users>

    @ManyToOne(() => Users, { nullable: true })
    sender: Relation<Users>
}
