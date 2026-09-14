import {
    Entity, Column, PrimaryGeneratedColumn,
    CreateDateColumn, ManyToOne, JoinColumn,
} from "typeorm";
import { AiElements } from "./AiElement.entity";
import { Assets } from "../../asset/entities/Asset.entity";

@Entity({ name: "ai_element_images" })
export class AiElementImages {
    @PrimaryGeneratedColumn("increment", { type: "bigint" })
    id!: number;

    @Column({ name: "element_id", type: "bigint" })
    elementId!: number;

    @Column({ name: "asset_id", type: "bigint" })
    assetId!: number;

    /** frontal | refer */
    @Column({ name: "image_role", length: 20 })
    imageRole!: string;

    @Column({ name: "sort_order", type: "int", default: 0 })
    sortOrder!: number;

    @CreateDateColumn({ name: "created_at", type: "timestamptz", default: () => "now()" })
    createdAt!: Date;

    @ManyToOne(() => AiElements, (el) => el.images, { onDelete: "CASCADE" })
    @JoinColumn({ name: "element_id" })
    element!: AiElements;

    @ManyToOne(() => Assets)
    @JoinColumn({ name: "asset_id" })
    asset!: Assets;
}