import { Entity, Column, PrimaryColumn, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn, BeforeInsert } from "typeorm";
import { ulid } from "ulid";
import { AiProviders } from "../../ai-provider/entities/AiProvider.entity";

@Entity({ name: "ai_models" })
export class AiModels {
    @PrimaryColumn("varchar", { length: 26 })
    id!: string;

    @Column({ name: "provider_id", type: "varchar", length: 26 })
    providerId!: string;

    @Column({ length: 100 })
    code!: string;

    @Column({ length: 255 })
    name!: string;

    @Column({ name: "model_type", length: 50 })
    modelType!: string;

    @Column({ length: 50, nullable: true })
    version!: string;

    @Column({ type: "text", nullable: true })
    description!: string;

    @Column({ name: "is_active", type: "boolean", default: true })
    isActive!: boolean;

    @Column({ name: "supports_motion_control", type: "boolean", default: false })
    supportsMotionControl!: boolean;

    @Column({ name: "supports_elements", type: "boolean", default: false })
    supportsElements!: boolean;

    @Column({ name: "supports_element_video", type: "boolean", default: false })
    supportsElementVideo!: boolean;

    @CreateDateColumn({ name: "created_at", type: "timestamptz", default: () => "now()" })
    createdAt!: Date;

    @UpdateDateColumn({ name: "updated_at", type: "timestamptz", default: () => "now()" })
    updatedAt!: Date;

    @ManyToOne(() => AiProviders, (provider) => provider.models)
    @JoinColumn({ name: "provider_id" })
    provider!: AiProviders;

    @BeforeInsert()
    generateId() {
        if (!this.id) {
            this.id = ulid();
        }
    }
}