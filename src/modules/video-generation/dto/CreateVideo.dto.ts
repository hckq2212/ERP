export interface MultiPromptItem {
    index: number;
    prompt: string;
    duration: string;
}

export interface CreateVideoDto {
    projectId: string;
    modelId: string;
    resolution?: string;

    prompt: string;
    negativePrompt?: string;
    duration?: string;
    mode?: "std" | "pro" | "4k" | "480p" | "720p" | "1080p";
    sound?: "on" | "off";
    ratio?: string;
    cost?: number;

    // ── Multi-Shot (chỉ Kling) ─────────────────────────────────────────────
    multiShot?: boolean;
    // 'customize': user cung cấp multiPrompt; 'intelligence': Kling tự phân cảnh
    shotType?: "customize" | "intelligence";
    // Chỉ dùng khi shotType = 'customize' (1–6 items)
    multiPrompt?: MultiPromptItem[];

    startImageAssetId?: number;
    endImageAssetId?: number;
}

export interface CreateMotionControlVideoDto {
    projectId: string;
    modelId: string;

    prompt?: string;
    negativePrompt?: string;

    // 'image': khớp hướng theo ảnh nhân vật (video ref tối đa 10s)
    // 'video': khớp hướng theo video ref (video ref tối đa 30s)
    characterOrientation: "image" | "video";

    keepOriginalSound?: "yes" | "no";
    mode?: "std" | "pro";
    cost?: number;

    characterImageAssetId?: number;
    referenceVideoAssetId?: number;
}