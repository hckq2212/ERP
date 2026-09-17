import axios from "axios";
import { ProjectProductDescriptionService } from "../../project/services/ProjectProductDescription.Service";
import { ProjectProductDescriptionStatus } from "../../project/entities/ProjectProductDescriptionSubmission.entity";

const AI_SERVICE_URL = (process.env.AI_SERVICE_URL || process.env.SPELLING_CHECKER_URL || "http://localhost:8000").replace(/\/$/, "");
const MAX_FETCH_BYTES = 500 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

type Actor = { id: string; userId?: string; role: string; username?: string };

function httpError(message: string, statusCode: number) {
    const error = new Error(message) as Error & { statusCode?: number };
    error.statusCode = statusCode;
    return error;
}

async function fetchRemoteFile(fileUrl: string): Promise<Buffer> {
    let fileRes;
    try {
        fileRes = await axios.get(fileUrl, {
            responseType: "arraybuffer",
            maxContentLength: MAX_FETCH_BYTES,
            maxRedirects: 5,
            timeout: REQUEST_TIMEOUT_MS,
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            },
        });
    } catch (e: any) {
        throw httpError("Không thể tải file từ link, vui lòng kiểm tra lại đường dẫn hoặc quyền chia sẻ", 400);
    }

    const contentType = String(fileRes.headers?.["content-type"] || "");
    if (contentType.includes("text/html")) {
        throw httpError("Không thể tải file từ link. Với Google Sheets, hãy bật chia sẻ 'Bất kỳ ai có đường liên kết' rồi thử lại", 400);
    }

    return Buffer.from(fileRes.data);
}

function flattenSpecValue(spec: any): string {
    if (Array.isArray(spec?.subKeys) && spec.subKeys.length > 0) {
        return spec.subKeys.map((sk: any) => `${sk.key}: ${sk.value}`).join("; ");
    }
    return spec?.value || "";
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

    async listSheets(fileBuffer: Buffer, fileName: string) {
        const formData = new FormData();
        formData.append("file", new Blob([new Uint8Array(fileBuffer)]), fileName);
        const res = await axios.post(`${AI_SERVICE_URL}/qc/sheets`, formData, {
            timeout: REQUEST_TIMEOUT_MS,
            maxBodyLength: MAX_FETCH_BYTES,
            maxContentLength: MAX_FETCH_BYTES,
        });
        return res.data;
    }

    async listSheetsFromUrl(fileUrl: string, fileName: string) {
        const buffer = await fetchRemoteFile(fileUrl);
        return this.listSheets(buffer, fileName);
    }

    async getApprovedProductInfo(projectId: string, actor?: Actor) {
        const submissions = await this.productDescriptionService.getByProject(projectId, actor);
        const approved = submissions.find((submission) => submission.status === ProjectProductDescriptionStatus.APPROVED);

        if (!approved) {
            console.log(`[QC_DEBUG] projectId=${projectId} chua co product description duoc duyet -> QC se bi bo qua (0 mismatch, khong bao loi)`);
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
        fileBuffer?: Buffer;
        fileName?: string;
        fileUrl?: string;
        sheetNames: string[];
        projectId: string;
        extractModel?: string;
        verifyModel?: string;
        scenarioIds?: string[];
        actor?: Actor;
    }) {
        const productInfo = await this.getApprovedProductInfo(params.projectId, params.actor);
        const aiProductInfo = toAiProductInfo(productInfo);

        let fileBuffer = params.fileBuffer;
        let fileName = params.fileName;
        if (!fileBuffer && params.fileUrl) {
            fileBuffer = await fetchRemoteFile(params.fileUrl);
            fileName = fileName || "result";
        }
        if (!fileBuffer) {
            throw httpError("Cần cung cấp file hoặc url", 400);
        }

        const sheetNames = params.sheetNames.filter(Boolean);
        if (sheetNames.length === 0) {
            throw httpError("Vui lòng chọn ít nhất 1 sheet để chạy QC", 400);
        }

        const finalFileBuffer = fileBuffer;
        const finalFileName = fileName;

        const sheetResults = await Promise.all(sheetNames.map(async (sheetName) => {
            const sheetScenarioIds = params.scenarioIds
                ? params.scenarioIds.filter((sid) => sid.startsWith(`${sheetName}::`))
                : null;
            if (params.scenarioIds && sheetScenarioIds!.length === 0) {
                console.log(`[QC_DEBUG] sheet=${sheetName} khong co scenarioId nao khop trong danh sach da chon (${JSON.stringify(params.scenarioIds)}) -> bo qua sheet nay, tra ve rong`);
                return { sheetName, data: { content_blocks: [], mismatch_report: { mismatches: [] }, models: null } };
            }

            const formData = new FormData();
            formData.append("file", new Blob([new Uint8Array(finalFileBuffer)]), finalFileName || "result");
            formData.append("sheet_name", sheetName);
            formData.append("product_info", JSON.stringify(aiProductInfo));
            if (params.verifyModel) formData.append("verify_model", params.verifyModel);
            if (sheetScenarioIds) formData.append("scenario_ids", sheetScenarioIds.join(","));

            let res;
            try {
                res = await axios.post(`${AI_SERVICE_URL}/qc/run`, formData, {
                    timeout: REQUEST_TIMEOUT_MS,
                    maxBodyLength: MAX_FETCH_BYTES,
                    maxContentLength: MAX_FETCH_BYTES,
                });
            } catch (err: any) {
                console.log(`[QC_DEBUG] /qc/run that bai sheet=${sheetName} status=${err?.response?.status} detail=${JSON.stringify(err?.response?.data)} message=${err?.message}`);
                throw err;
            }
            return { sheetName, data: res.data };
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