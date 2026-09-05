import { Entity, Column, ManyToOne, Relation } from "typeorm"
import { BaseEntity } from "../../../shared/entities/BaseEntity"
import { Users } from "../../user/entities/User.entity"

@Entity()
export class Notifications extends BaseEntity {

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
