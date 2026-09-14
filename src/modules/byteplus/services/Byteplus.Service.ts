import axios from "axios";

export interface BytePlusContentItem {
    type: "text" | "image_url";
    text?: string;
    image_url?: { url: string };
    role?: "first_frame" | "last_frame";
}

export interface BytePlusCreateVideoDto {
    modelCode: string;
    prompt: string;
    imageUrl: string;
    imageTailUrl?: string;
    resolution?: string;
    ratio?: string;
    duration?: number;
    generateAudio?: boolean;
}

export interface BytePlusTaskResult {
    id: string;
    model: string;
    status: "queued" | "running" | "succeeded" | "failed" | "expired" | "cancelled";
    content?: { video_url?: string };
    error?: { code?: string; message?: string };
    resolution?: string;
    ratio?: string;
    duration?: number;
    created_at: number;
    updated_at: number;
}

export class ByteplusService {
    private readonly baseUrl = "https://ark.ap-southeast.bytepluses.com";
    private readonly logPrefix = "[BytePlus]";

    private get headers() {
        const apiKey = process.env.ARK_API_KEY;
        if (!apiKey) {
            throw new Error("Thiếu cấu hình ARK_API_KEY trong .env");
        }
        return {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        };
    }

    async createVideoTask(dto: BytePlusCreateVideoDto): Promise<BytePlusTaskResult> {
        const content: BytePlusContentItem[] = [{ type: "text", text: dto.prompt }];

        if (dto.imageTailUrl) {
            content.push({ type: "image_url", image_url: { url: dto.imageUrl }, role: "first_frame" });
            content.push({ type: "image_url", image_url: { url: dto.imageTailUrl }, role: "last_frame" });
        } else {
            content.push({ type: "image_url", image_url: { url: dto.imageUrl }, role: "first_frame" });
        }

        const payload: Record<string, any> = {
            model: dto.modelCode,
            content,
            resolution: dto.resolution || "720p",
            ratio: dto.ratio || "adaptive",
            duration: dto.duration ?? 5,
            generate_audio: dto.generateAudio ?? true,
        };

        console.log(`${this.logPrefix} createVideoTask payload: ${JSON.stringify(payload)}`);

        try {
            const response = await axios.post<BytePlusTaskResult>(
                `${this.baseUrl}/api/v3/contents/generations/tasks`,
                payload,
                { headers: this.headers }
            );
            return response.data;
        } catch (err: any) {
            console.error(
                `${this.logPrefix} createVideoTask FAILED - status: ${err.response?.status}, ` +
                `data: ${JSON.stringify(err.response?.data)}`
            );
            throw err;
        }
    }

    async getTaskStatus(taskId: string): Promise<BytePlusTaskResult> {
        try {
            const response = await axios.get<BytePlusTaskResult>(
                `${this.baseUrl}/api/v3/contents/generations/tasks/${taskId}`,
                { headers: this.headers }
            );
            return response.data;
        } catch (err: any) {
            console.error(
                `${this.logPrefix} getTaskStatus error - status: ${err.response?.status}, ` +
                `data: ${JSON.stringify(err.response?.data)}`
            );
            throw err;
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async pollUntilDone(
        taskId: string,
        intervalMs = 10000,
        maxAttempts = 60
    ): Promise<BytePlusTaskResult> {
        console.log(`${this.logPrefix} Start polling taskId: ${taskId}`);
        let consecutiveErrors = 0;
        const maxConsecutiveErrors = 3;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            await this.sleep(intervalMs);

            try {
                const task = await this.getTaskStatus(taskId);
                consecutiveErrors = 0;

                console.log(`${this.logPrefix} Attempt ${attempt}/${maxAttempts} - status: ${task.status}`);

                if (task.status === "succeeded") {
                    console.log(`${this.logPrefix} Task ${taskId} SUCCEEDED`);
                    return task;
                }

                if (task.status === "failed" || task.status === "expired" || task.status === "cancelled") {
                    throw new Error(`BytePlus task ${task.status}: ${task.error?.message || "unknown error"}`);
                }
            } catch (err: any) {
                if (err.message?.startsWith("BytePlus task")) throw err;

                consecutiveErrors++;
                console.warn(
                    `${this.logPrefix} Attempt ${attempt} error (${consecutiveErrors}/${maxConsecutiveErrors}): ${err.message}`
                );
                if (consecutiveErrors >= maxConsecutiveErrors) {
                    throw new Error(
                        `BytePlus polling aborted after ${maxConsecutiveErrors} consecutive errors: ${err.message}`
                    );
                }
            }
        }

        throw new Error(`BytePlus task ${taskId} timeout sau ${maxAttempts} lần poll`);
    }
}