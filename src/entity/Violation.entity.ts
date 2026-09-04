import { Entity, Column, ManyToOne, JoinColumn } from "typeorm";
import { BaseEntity } from "./BaseEntity";
import { Tasks } from "./Task.entity";
import { Users } from "./User.entity";
import { ViolationType } from "./Enums";

@Entity()
export class Violations extends BaseEntity {

    @ManyToOne(() => Tasks)
    @JoinColumn({ name: "taskId" })
    task: Tasks;

    @Column({ type: "varchar", length: 26 })
    taskId: string;

    @ManyToOne(() => Users)
    @JoinColumn({ name: "userId" })
    user: Users;

    @Column({ type: "varchar", length: 26 })
    userId: string;

    @Column({
        type: "enum",
        enum: ViolationType
    })
    type: ViolationType;

    @Column({ type: "text", nullable: true })
    description: string;

    @Column({ type: "int", nullable: true })
    iterationVersion: number;
}
