import { Entity, Column, ManyToOne, JoinColumn } from "typeorm";
import { BaseEntity } from "../../../shared/entities/BaseEntity";
import { Projects } from "./Project.entity";
import { Users } from "../../user/entities/User.entity";

export enum PauseRequestStatus {
    PENDING = "PENDING",
    APPROVED = "APPROVED",
    REJECTED = "REJECTED",
    RESUMED = "RESUMED",
    CLOSED = "CLOSED"
}

/**
 * REQUEST = PM hoặc BD xin phép, chờ BOD duyệt
 * DIRECT  = BOD/ADMIN tự quyết dừng ngay (không qua duyệt)
 */
export enum PauseMode {
    REQUEST = "REQUEST",
    DIRECT = "DIRECT"
}

/** USER = có người bấm đóng · SYSTEM = cron force đóng ở D+37 */
export enum ClosedByType {
    USER = "USER",
    SYSTEM = "SYSTEM"
}

/** DIRECT = BD/BOD/ADMIN đóng ngay · REQUEST = PM đề nghị, BOD duyệt */
export enum CloseMode {
    REQUEST = "REQUEST",
    DIRECT = "DIRECT"
}

/**
 * Đơn tạm dừng dự án — NGUỒN SỰ THẬT cho lịch sử tạm dừng/đóng dự án.
 *
 * Một dự án có thể tạm dừng NHIỀU LẦN trong vòng đời → mỗi lần là 1 bản ghi.
 * `Projects` chỉ cache `pausedAt`/`autoAcceptAt` để cron query nhanh.
 */
@Entity()
export class ProjectPauseRequests extends BaseEntity {

    @ManyToOne(() => Projects, { onDelete: "CASCADE" })
    @JoinColumn({ name: "projectId" })
    project: Projects;

    @Column({ type: "varchar", length: 26 })
    projectId: string;

    // ── Yêu cầu tạm dừng ────────────────────────────────────────────────

    @ManyToOne(() => Users, { nullable: true })
    @JoinColumn({ name: "requesterId" })
    requester: Users;

    @Column({ type: "varchar", length: 26, nullable: true })
    requesterId: string;

    /** PM | BD | BOD | ADMIN — để truy vết và thống kê */
    @Column({ type: "varchar", length: 20, nullable: true })
    requesterRole: string;

    @Column({ type: "enum", enum: PauseMode, default: PauseMode.REQUEST })
    pauseMode: PauseMode;

    @Column({ type: "text" })
    reason: string;

    @Column({ type: "enum", enum: PauseRequestStatus, default: PauseRequestStatus.PENDING })
    status: PauseRequestStatus;

    @ManyToOne(() => Users, { nullable: true })
    @JoinColumn({ name: "approverId" })
    approver: Users;

    @Column({ type: "varchar", length: 26, nullable: true })
    approverId: string;

    /** Lý do BOD từ chối đơn tạm dừng. */
    @Column({ type: "text", nullable: true })
    feedback: string;

    @Column({ type: "timestamptz", nullable: true })
    requestedAt: Date;

    @Column({ type: "timestamptz", nullable: true })
    approvedAt: Date;

    /** Mốc D+37 của lần tạm dừng này (`approvedAt + 37 ngày`). */
    @Column({ type: "timestamptz", nullable: true })
    autoAcceptAt: Date;

    // ── Resume (làm tiếp) ───────────────────────────────────────────────

    @Column({ type: "timestamptz", nullable: true })
    resumedAt: Date;

    @Column({ type: "text", nullable: true })
    resumeReason: string;

    // ── Đóng dự án ──────────────────────────────────────────────────────

    @Column({ type: "enum", enum: CloseMode, nullable: true })
    closeMode: CloseMode;

    @Column({ type: "enum", enum: ClosedByType, nullable: true })
    closedByType: ClosedByType;

    @ManyToOne(() => Users, { nullable: true })
    @JoinColumn({ name: "closedById" })
    closedBy: Users;

    @Column({ type: "varchar", length: 26, nullable: true })
    closedById: string;

    @Column({ type: "timestamptz", nullable: true })
    closedAt: Date;

    @Column({ type: "text", nullable: true })
    closeReason: string;

    /** Thống kê khi đóng — phục vụ báo cáo, không dùng cho logic. */
    @Column({ type: "int", default: 0 })
    acceptedTaskCount: number;

    @Column({ type: "int", default: 0 })
    cancelledTaskCount: number;

    /** Danh sách task đã được nghiệm thu trong đợt tạm dừng này. */
    @Column({ type: "jsonb", nullable: true, default: [] })
    acceptedTaskIds: string[];
}
