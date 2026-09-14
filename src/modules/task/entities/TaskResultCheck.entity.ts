import { Entity, Column, OneToOne, JoinColumn } from "typeorm";
import { BaseEntity } from "../../../shared/entities/BaseEntity";
import { Tasks } from "./Task.entity";

export enum TaskResultCheckStatus {
    PENDING = "PENDING",
    RUNNING = "RUNNING",
    DONE = "DONE",
    ERROR = "ERROR"
}

@Entity()
export class TaskResultChecks extends BaseEntity {

    @Column({ type: "varchar", length: 26 })
    taskId: string;

    @OneToOne(() => Tasks)
    @JoinColumn({ name: "taskId" })
    task: Tasks;

    @Column({
        type: "enum",
        enum: TaskResultCheckStatus,
        default: TaskResultCheckStatus.PENDING
    })
    status: TaskResultCheckStatus;

    @Column({ type: "simple-json", nullable: true })
    sheetNames: string[];

    @Column({ type: "varchar", nullable: true })
    filteredFileUrl: string | null;

    @Column({ type: "simple-json", nullable: true })
    spellErrors: { id: string; location: string; token: string }[];

    @Column({ type: "simple-json", nullable: true })
    qcMismatches: Record<string, any>[];

    @Column({ type: "simple-json", nullable: true })
    reviewedSpellErrors: { id: string; location: string; token: string; confirmed: boolean }[];

    @Column({ type: "simple-json", nullable: true })
    reviewedQcMismatches: (Record<string, any> & { id: string; confirmed: boolean })[];

    @Column({ type: "simple-json", nullable: true })
    reviewerWhitelist: string[] | null;

    @Column({ type: "text", nullable: true })
    errorMessage: string | null;

    @Column({ type: "timestamptz", nullable: true })
    finalizedAt: Date | null;
}
