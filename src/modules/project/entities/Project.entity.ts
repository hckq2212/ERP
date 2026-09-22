import { Entity, Column, OneToOne, JoinColumn, ManyToOne, OneToMany, Index } from "typeorm";
import { BaseEntity } from "../../../shared/entities/BaseEntity";
import { Contracts } from "../../contract/entities/Contract.entity";
import { ProjectTeams } from "./ProjectTeam.entity";
import { Tasks } from "../../task/entities/Task.entity";
import { Users } from "../../user/entities/User.entity";

export enum ProjectStatus {
    PENDING_CONFIRMATION = "PENDING_CONFIRMATION", // Chờ xác nhận
    CONFIRMED = "CONFIRMED", // Team Lead đã nhận
    IN_PROGRESS = "IN_PROGRESS", // Đang thực hiện (sau khi upload hợp đồng đã ký)
    PENDING_PAUSE_APPROVAL = "PENDING_PAUSE_APPROVAL", // Chờ duyệt yêu cầu tạm dừng
    ON_HOLD = "ON_HOLD", // Tạm dừng — task bị khoá, không thao tác được
    COMPLETED = "COMPLETED",
    CANCELLED = "CANCELLED"
}

export enum GoogleSheetStatus {
    NOT_CREATED = "NOT_CREATED",
    CREATING = "CREATING",
    CREATED = "CREATED",
    FAILED = "FAILED"
}

@Entity()
export class Projects extends BaseEntity {

    @Column()
    name: string;

    @OneToOne(() => Contracts, (contract) => contract.project)
    @JoinColumn()
    contract: Contracts;

    @ManyToOne(() => ProjectTeams, (team) => team.projects)
    team: ProjectTeams;

    @Column({
        type: "enum",
        enum: ProjectStatus,
        default: ProjectStatus.PENDING_CONFIRMATION
    })
    status: ProjectStatus;

    @Column({ type: "date", nullable: true })
    plannedStartDate: Date;

    @Column({ type: "date", nullable: true })
    plannedEndDate: Date;

    @Column({ type: "date", nullable: true })
    actualStartDate: Date;

    @Column({ type: "date", nullable: true })
    actualEndDate: Date;

    @OneToMany(() => Tasks, (task) => task.project)
    tasks: Tasks[];

    @ManyToOne(() => Users)
    createdBy: Users;

    @Column({ nullable: true })
    googleSheetId: string;

    @Column({ nullable: true })
    googleSheetUrl: string;

    @Column({
        type: "enum",
        enum: GoogleSheetStatus,
        default: GoogleSheetStatus.NOT_CREATED
    })
    googleSheetStatus: GoogleSheetStatus;

    @Column({ type: "text", nullable: true })
    googleSheetError: string;

    @Column({ type: "timestamp", nullable: true })
    googleSheetCreatedAt: Date;

    /** D0 — thời điểm dự án vào ON_HOLD (mốc neo tính 37 ngày). */
    @Column({ type: "timestamptz", nullable: true })
    pausedAt: Date;

    /** Mốc D+37 = `pausedAt + 37 ngày` (ngày trọn vẹn, giữ nguyên giờ:phút). */
    @Column({ type: "timestamptz", nullable: true })
    autoAcceptAt: Date;

    /** Ngày đã gửi thông báo nhắc nhở — chống gửi lặp trong cùng 1 ngày. */
    @Column({ type: "date", nullable: true })
    lastReminderDate: Date;

    /** Đơn tạm dừng đang hiệu lực. */
    @Column({ type: "varchar", length: 26, nullable: true })
    currentPauseRequestId: string;

    /** Ai bấm tạm dừng (BOD / ADMIN). */
    @ManyToOne(() => Users, { nullable: true })
    @JoinColumn({ name: "pausedById" })
    pausedBy: Users;

    @Column({ type: "varchar", length: 26, nullable: true })
    pausedById: string;

    /** Cờ query nhanh cho cron — tránh phải join/lọc theo status. */
    @Index()
    @Column({ default: false })
    isOnHold: boolean;
}

