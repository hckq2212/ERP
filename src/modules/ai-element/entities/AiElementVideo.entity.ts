import {
    Entity, Column, PrimaryGeneratedColumn,
    CreateDateColumn, ManyToOne, JoinColumn, OneToOne,
} from "typeorm";
import { AiElements } from "./AiElement.entity";
import { Assets } from "../../asset/entities/Asset.entity";

@Entity({ name: "ai_element_videos" })
export class AiElementVideos {
    @PrimaryGeneratedColumn("increment", { type: "bigint" })
    id!: number;

    @Column({ name: "element_id", type: "bigint" })
    elementId!: number;

    @Column({ name: "asset_id", type: "bigint" })
    assetId!: number;

    @CreateDateColumn({ name: "created_at", type: "timestamptz", default: () => "now()" })
    createdAt!: Date;

    @OneToOne(() => AiElements, (el) => el.video, { onDelete: "CASCADE" })
    @JoinColumn({ name: "element_id" })
    element!: AiElements;

    @ManyToOne(() => Assets)
    @JoinColumn({ name: "asset_id" })
    asset!: Assets;
}