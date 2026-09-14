import {
    Entity, Column, PrimaryGeneratedColumn,
    CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, OneToMany, OneToOne,
} from "typeorm";
import { Accounts } from "../../account/entities/Account.entity";
import { Projects } from "../../project/entities/Project.entity";
import { AiProviders } from "../../ai-provider/entities/AiProvider.entity";
import { AiElementImages } from "./AiElementImage.entity";
import { AiElementVideos } from "./AiElementVideo.entity";

/**
 * Maps to: public.ai_elements
 * id bigint IDENTITY (giống Assets/VideoGenerations, KHÔNG dùng BaseEntity ULID).
 * project_id nullable — element được tạo độc lập, chưa gắn project khi mới tạo.
 */
@Entity({ name: "ai_elements" })
export class AiElements {
    @PrimaryGeneratedColumn("increment", { type: "bigint" })
    id!: number;

    @Column({ name: "user_id", type: "varchar", length: 26 })
    userId!: string;

    @Column({ name: "project_id", type: "varchar", length: 26, nullable: true })
    projectId?: string | null;

    @Column({ name: "provider_id", type: "varchar", length: 26 })
    providerId!: string;

    @Column({ name: "element_name", length: 20 })
    elementName!: string;

    @Column({ name: "element_description", length: 100 })
    elementDescription!: string;

    /** image_refer | video_refer */
    @Column({ name: "reference_type", length: 20 })
    referenceType!: string;

    @Column({ name: "external_element_id", length: 255, nullable: true })
    externalElementId?: string | null;

    /** pending | processing | succeeded | failed */
    @Column({ length: 50, default: "pending" })
    status!: string;

    @Column({ name: "element_voice_id", length: 255, nullable: true })
    elementVoiceId?: string | null;

    @Column({ name: "tag_list", type: "jsonb", default: "[]" })
    tagList!: any[];

    @Column({ name: "request_payload", type: "jsonb", default: "{}" })
    requestPayload!: object;

    @Column({ name: "response_payload", type: "jsonb", default: "{}" })
    responsePayload!: object;

    @Column({ name: "error_message", type: "text", nullable: true })
    errorMessage?: string | null;

    @CreateDateColumn({ name: "created_at", type: "timestamptz", default: () => "now()" })
    createdAt!: Date;

    @UpdateDateColumn({ name: "updated_at", type: "timestamptz", default: () => "now()" })
    updatedAt!: Date;

    @Column({ name: "is_favorite", type: "boolean", default: false })
    isFavorite!: boolean;

    // ── Relations ────────────────────────────────────────────────────────
    @ManyToOne(() => Accounts)
    @JoinColumn({ name: "user_id" })
    user!: Accounts;

    @ManyToOne(() => Projects, { nullable: true })
    @JoinColumn({ name: "project_id" })
    project?: Projects;

    @ManyToOne(() => AiProviders)
    @JoinColumn({ name: "provider_id" })
    provider!: AiProviders;

    @OneToMany(() => AiElementImages, (img) => img.element)
    images!: AiElementImages[];

    @OneToOne(() => AiElementVideos, (vid) => vid.element)
    video?: AiElementVideos;
}