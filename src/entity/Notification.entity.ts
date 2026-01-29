import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, Relation } from "typeorm"
import { BaseEntity } from "./BaseEntity"
import { Users } from "./User.entity"

@Entity()
export class Notifications extends BaseEntity {

    @PrimaryGeneratedColumn()
    id: number

    @Column()
    title: string

    @Column({ type: "text" })
    content: string

    @Column()
    type: string // e.g., 'TASK', 'CONTRACT', 'SYSTEM', 'MESSAGE'

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
