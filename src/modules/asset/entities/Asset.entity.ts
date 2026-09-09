import {
    Entity, PrimaryGeneratedColumn, Column,
    CreateDateColumn, ManyToOne, JoinColumn,
} from "typeorm";
import { Accounts } from "../../account/entities/Account.entity";
import { Projects } from "../../project/entities/Project.entity";

/**
 * Maps to: public.assets
 *
 * LƯU Ý: Asset KHÔNG kế thừa BaseEntity (id ULID) như các entity nghiệp vụ
 * khác của ERP. Trong DB, assets.id là bigint IDENTITY (giống video/motion
 * generations), trong khi user_id/project_id vẫn là varchar(26) ULID trỏ
 * sang Accounts/Projects. Đây là bảng lưu trung tâm mọi ảnh/video dùng cho
 * AI generation (ảnh đầu/cuối, ảnh nhân vật, video tham chiếu, video/thumbnail
 * kết quả) — video_generations/motion_generations chỉ lưu FK bigint trỏ vào đây.
 */
@Entity({ name: "assets" })
export class Assets {
    @PrimaryGeneratedColumn("increment", { type: "bigint" })
    id!: number;

    @Column({ name: "user_id", type: "varchar", length: 26 })
    userId!: string;

    @Column({ name: "project_id", type: "varchar", length: 26, nullable: true })
    projectId?: string;

    /** image | video | audio | thumbnail | json | text | subtitle */
    @Column({ name: "asset_type", length: 50 })
    assetType!: string;

    /** image_begin | image_end | scene_video | ... (tuỳ ngữ cảnh sử dụng) */
    @Column({ name: "asset_role", length: 50, nullable: true })
    assetRole?: string;

    /** uploaded | generated | external — DB default: 'generated' */
    @Column({ name: "source_type", length: 50, default: "generated" })
    sourceType!: string;

    @Column({ name: "original_url", type: "text", nullable: true })
    originalUrl?: string;

    @Column({ name: "stored_url", type: "text" })
    storedUrl!: string;

    @Column({ name: "thumbnail_url", type: "text", nullable: true })
    thumbnailUrl?: string;

    @Column({ name: "storage_provider", length: 50, nullable: true })
    storageProvider?: string;

    @Column({ name: "mime_type", length: 100, nullable: true })
    mimeType?: string;

    @Column({ name: "file_size_bytes", type: "bigint", nullable: true })
    fileSizeBytes?: number;

    @Column({ type: "int", nullable: true })
    width?: number;

    @Column({ type: "int", nullable: true })
    height?: number;

    @Column({ name: "duration_seconds", type: "int", nullable: true })
    durationSeconds?: number;

    @Column({ type: "int", nullable: true })
    fps?: number;

    @Column({ type: "jsonb", default: "{}" })
    metadata!: object;

    @CreateDateColumn({ name: "created_at", type: "timestamptz", default: () => "now()" })
    createdAt!: Date;

    @Column({ name: "is_favorite", type: "boolean", default: false })
    isFavorite!: boolean;

    // ── Relations ────────────────────────────────────────────────────────
    @ManyToOne(() => Accounts)
    @JoinColumn({ name: "user_id" })
    user?: Accounts;

    @ManyToOne(() => Projects)
    @JoinColumn({ name: "project_id" })
    project?: Projects;
}