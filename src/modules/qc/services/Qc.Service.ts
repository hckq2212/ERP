import axios from "axios";
import { ProjectProductDescriptionService } from "../../project/services/ProjectProductDescription.Service";
import { ProjectProductDescriptionStatus } from "../../project/entities/ProjectProductDescriptionSubmission.entity";
import { SettingService } from "../../setting/services/Setting.Service";
import {
    AI_SERVICE_URL,
    AI_SERVICE_MAX_FETCH_BYTES as MAX_FETCH_BYTES,
    AI_SERVICE_REQUEST_TIMEOUT_MS as REQUEST_TIMEOUT_MS,
    AI_SERVICE_POLL_INTERVAL_MS,
} from "../../../shared/config/aiService";

type Actor = { id: string; userId?: string; role: string; username?: string };

function httpError(message: string, statusCode: number) {
    const error = new Error(message) as Error & { statusCode?: number };
    error.statusCode = statusCode;
    return error;
}

function flattenSpecValue(spec: any): string {
    if (Array.isArray(spec?.subKeys) && spec.subKeys.length > 0) {
        return spec.subKeys.map((sk: any) => `${sk.key}: ${sk.value}`).join("; ");
    }
    return spec?.value || "";
}

async function submitAndPollQcJob(formData: FormData) {
    const submitRes = await axios.post(`${AI_SERVICE_URL}/qc/run`, formData, {
        timeout: REQUEST_TIMEOUT_MS,
        maxBodyLength: MAX_FETCH_BYTES,
        maxContentLength: MAX_FETCH_BYTES,
    });
    const jobId = submitRes.data.job_id;
    const start = Date.now();

    while (true) {
        const statusRes = await axios.get(`${AI_SERVICE_URL}/qc/run/${jobId}`, { timeout: 10000 });
        const job = statusRes.data;
        if (job.status === "done") {
            return job;
        }
        if (job.status === "error") {
            throw httpError(job.error || "Chạy QC thất bại", 502);
        }
        if (Date.now() - start > REQUEST_TIMEOUT_MS) {
            throw httpError("Chạy QC quá thời gian chờ", 504);
        }
        await new Promise((resolve) => setTimeout(resolve, AI_SERVICE_POLL_INTERVAL_MS));
    }
}

function toAiProductInfo(productInfo: any[]) {
    return productInfo.map((item) => ({
        ...item,
        specs: (item.specs || []).map((spec: any) => ({
            key: spec.key,
            value: flattenSpecValue(spec)
        }))
    }));
}

export class QcService {
    private productDescriptionService = new ProjectProductDescriptionService();
    private settingService = new SettingService();

    async getApprovedProductInfo(projectId: string, actor?: Actor) {
        const submissions = await this.productDescriptionService.getByProject(projectId, actor);
        const approved = submissions.find((submission) => submission.status === ProjectProductDescriptionStatus.APPROVED);

        if (!approved) {
            throw httpError("Dự án chưa có thông tin chuẩn sản phẩm được duyệt, không thể chạy QC", 400);
        }

        return approved.items.map((item) => ({
            productName: item.productName,
            specs: item.specs,
            note: item.note,
            docUrl: item.docUrl,
        }));
    }

    async run(params: {
        fileBuffer: Buffer;
        fileName?: string;
        sheetNames: string[];
        projectId: string;
        scenarioIds?: string[];
        actor?: Actor;
    }) {
        const productInfo = await this.getApprovedProductInfo(params.projectId, params.actor);
        const aiProductInfo = toAiProductInfo(productInfo);

        const qcConfig = await this.settingService.getQcConfig();

        const sheetNames = params.sheetNames.filter(Boolean);
        if (sheetNames.length === 0) {
            throw httpError("Vui lòng chọn ít nhất 1 sheet để chạy QC", 400);
        }

        const fileBuffer = params.fileBuffer;
        const fileName = params.fileName;

        const sheetResults = await Promise.all(sheetNames.map(async (sheetName) => {
            const sheetScenarioIds = params.scenarioIds
                ? params.scenarioIds.filter((sid) => sid.startsWith(`${sheetName}::`))
                : null;
            if (params.scenarioIds && sheetScenarioIds!.length === 0) {
                return { sheetName, data: { content_blocks: [], mismatch_report: { mismatches: [] }, models: null } };
            }

            const formData = new FormData();
            formData.append("file", new Blob([new Uint8Array(fileBuffer)]), fileName || "result");
            formData.append("sheet_name", sheetName);
            formData.append("product_info", JSON.stringify(aiProductInfo));
            if (qcConfig.isCustomized) {
                formData.append("provider", qcConfig.provider);
                formData.append("verify_model", qcConfig.verifyModel);
            }
            formData.append("max_scenarios_per_batch", String(qcConfig.maxBatch));
            formData.append("context_window", String(qcConfig.maxContext));
            if (sheetScenarioIds) formData.append("scenario_ids", sheetScenarioIds.join(","));

            const data = await submitAndPollQcJob(formData);
            return { sheetName, data };
        }));

        const mismatches = sheetResults.flatMap(({ sheetName, data }) =>
            (data?.mismatch_report?.mismatches || []).map((m: any) => ({ ...m, sheet_name: sheetName }))
        );

        const contentBlocks: Record<string, any> = {};
        for (const { sheetName, data } of sheetResults) {
            contentBlocks[sheetName] = data?.content_blocks;
        }

        return {
            sheets: sheetNames,
            content_blocks: contentBlocks,
            mismatch_report: { mismatches },
            models: sheetResults[0]?.data?.models,
        };
    }
}
