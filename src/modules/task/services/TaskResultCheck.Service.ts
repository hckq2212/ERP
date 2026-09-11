import axios from "axios";
import path from "path";
import PDFDocument from "pdfkit";
import { AppDataSource } from "../../../data-source";
import { TaskResultChecks, TaskResultCheckStatus } from "../entities/TaskResultCheck.entity";
import { SpellingCheckService } from "../../spelling-check/services/SpellingCheck.Service";
import { QcService } from "../../qc/services/Qc.Service";
import { filterWorkbookSheets } from "../../../shared/helpers/xlsxFilter.helper";
import { rawLocationToExcelRef } from "../../../shared/helpers/excelRef.helper";
import { buildHighlightedWorkbook } from "../../../shared/helpers/xlsxHighlight.helper";
import { drawTable } from "../../../shared/helpers/pdfTable.helper";
import { uploadBufferToCloudinary } from "../../../shared/helpers/cloudinary.helper";
import { isProjectManagementRole } from "../../account/entities/Account.entity";
import { TaskBaseService } from "./Task.BaseService";
import { Tasks } from "../entities/Task.entity";

const MAX_FETCH_BYTES = 500 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const SHEET_EXTENSIONS = ["xlsx", "xlsm"];
const FONT_REGULAR = path.join(__dirname, "../../../../assets/fonts/DejaVuSans.ttf");
const FONT_BOLD = path.join(__dirname, "../../../../assets/fonts/DejaVuSans-Bold.ttf");

type Actor = { id?: string; userId?: string; role?: string };

function getExt(name: string) {
    return (name.split(".").pop() || "").toLowerCase();
}

async function fetchRemoteFile(fileUrl: string): Promise<Buffer> {
    const res = await axios.get(fileUrl, {
        responseType: "arraybuffer",
        maxContentLength: MAX_FETCH_BYTES,
        maxRedirects: 5,
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        },
    });
    return Buffer.from(res.data);
}

export class TaskResultCheckService extends TaskBaseService {
    private repository = AppDataSource.getRepository(TaskResultChecks);
    private spellingCheckService = new SpellingCheckService();
    private qcService = new QcService();

    private assertCanAccess(task: Tasks, actor?: Actor) {
        const actorUserId = this.getActorUserId(actor);
        const canAccess = isProjectManagementRole(actor?.role)
            || this.isProjectOperatorFromTeam(task.project?.team, actor)
            || task.assignerId === actorUserId;
        if (!canAccess) throw this.httpError("Bạn không có quyền xem thông tin kiểm tra của công việc này", 403);
    }

    async startForSubmission(params: {
        taskId: string;
        projectId?: string;
        fileBuffer?: Buffer;
        fileUrl?: string;
        fileName: string;
        sheetNames: string[];
        whitelist: string[];
        actor?: Actor;
    }) {
        const ext = getExt(params.fileName || "");
        if (!SHEET_EXTENSIONS.includes(ext) || params.sheetNames.length === 0) return;

        await this.repository.delete({ taskId: params.taskId });
        let record = this.repository.create({
            taskId: params.taskId,
            status: TaskResultCheckStatus.RUNNING,
            sheetNames: params.sheetNames
        });
        record = await this.repository.save(record);

        this.run(record.id, params).catch(async (err: any) => {
            await this.repository.update(record.id, {
                status: TaskResultCheckStatus.ERROR,
                errorMessage: err?.message || "Lỗi không xác định khi kiểm tra kết quả"
            });
        });
    }

    private async run(recordId: string, params: {
        taskId: string;
        projectId?: string;
        fileBuffer?: Buffer;
        fileUrl?: string;
        fileName: string;
        sheetNames: string[];
        whitelist: string[];
        actor?: Actor;
    }) {
        let buffer = params.fileBuffer;
        if (!buffer && params.fileUrl) buffer = await fetchRemoteFile(params.fileUrl);
        if (!buffer) throw new Error("Không có dữ liệu file để kiểm tra");

        const filteredBuffer = filterWorkbookSheets(buffer, params.sheetNames);
        const uploaded = await uploadBufferToCloudinary(filteredBuffer, params.fileName, `GETVINI/ERP/TASK/${params.taskId}/CHECKS`);

        const checked = await this.executeChecks(filteredBuffer, params.fileName, params.sheetNames, params.whitelist, params.projectId, params.actor);

        await this.repository.update(recordId, {
            status: TaskResultCheckStatus.DONE,
            filteredFileUrl: uploaded.url,
            ...checked
        });
    }

    private async executeSpellCheck(
        buffer: Buffer,
        fileName: string,
        sheetNames: string[],
        whitelist: string[]
    ) {
        const spellJob = await this.spellingCheckService.start(
            buffer,
            fileName,
            "both",
            sheetNames.join(","),
            whitelist.join(",")
        );
        const spellErrors = await this.pollSpellJob(spellJob.job_id);

        const spellErrorsWithId = spellErrors.map((e: any, idx: number) => ({
            id: `spell-${idx}`,
            location: rawLocationToExcelRef(e.location),
            token: e.token
        }));
        const reviewedSpellErrors = spellErrorsWithId.map(e => ({ ...e, confirmed: true }));

        return { spellErrors: spellErrorsWithId, reviewedSpellErrors };
    }

    private async executeQcCheck(
        buffer: Buffer,
        fileName: string,
        sheetNames: string[],
        projectId?: string,
        actor?: Actor
    ) {
        let qcMismatches: Record<string, any>[] = [];
        if (projectId) {
            try {
                const qcResult = await this.qcService.run({
                    fileBuffer: buffer,
                    fileName,
                    sheetNames,
                    projectId,
                    actor: actor as any
                });
                qcMismatches = qcResult?.mismatch_report?.mismatches || [];
            } catch {
                qcMismatches = [];
            }
        }

        const reviewedQcMismatches = qcMismatches.map((m: any, idx: number) => ({
            ...m,
            id: `qc-${idx}`,
            confirmed: true
        }));

        return { qcMismatches, reviewedQcMismatches };
    }

    private async executeChecks(
        buffer: Buffer,
        fileName: string,
        sheetNames: string[],
        whitelist: string[],
        projectId?: string,
        actor?: Actor
    ) {
        const spell = await this.executeSpellCheck(buffer, fileName, sheetNames, whitelist);
        const qc = await this.executeQcCheck(buffer, fileName, sheetNames, projectId, actor);
        return { ...spell, ...qc };
    }

    private async pollSpellJob(jobId: string): Promise<any[]> {
        const maxAttempts = 200;
        for (let i = 0; i < maxAttempts; i++) {
            const status = await this.spellingCheckService.getStatus(jobId);
            if (status.status === "done") return status.errors || [];
            if (status.status === "error") throw new Error(status.error || "Lỗi khi kiểm tra chính tả");
            await new Promise(resolve => setTimeout(resolve, 1500));
        }
        throw new Error("Kiểm tra chính tả quá thời gian chờ");
    }

    async getForTask(taskId: string, actor?: Actor) {
        const task = await this.getOne(taskId);
        this.assertCanAccess(task, actor);
        return await this.repository.findOne({ where: { taskId } });
    }

    async toggleItem(taskId: string, kind: "SPELL" | "QC", itemId: string, confirmed: boolean, actor?: Actor) {
        return this.toggleItems(taskId, kind, [itemId], confirmed, actor);
    }

    async toggleItems(taskId: string, kind: "SPELL" | "QC", itemIds: string[], confirmed: boolean, actor?: Actor) {
        const task = await this.getOne(taskId);
        this.assertCanAccess(task, actor);

        return await AppDataSource.transaction(async (manager) => {
            const repo = manager.getRepository(TaskResultChecks);
            const record = await repo.findOne({ where: { taskId }, lock: { mode: "pessimistic_write" } });
            if (!record) throw this.httpError("Không tìm thấy kết quả kiểm tra", 404);
            if (record.finalizedAt) throw this.httpError("Đã chốt kiểm tra, không thể chỉnh sửa", 409);

            const idSet = new Set(itemIds);
            if (kind === "SPELL") {
                record.reviewedSpellErrors = (record.reviewedSpellErrors || []).map(item =>
                    idSet.has(item.id) ? { ...item, confirmed } : item
                );
            } else {
                record.reviewedQcMismatches = (record.reviewedQcMismatches || []).map(item =>
                    idSet.has(item.id) ? { ...item, confirmed } : item
                );
            }

            return await repo.save(record);
        });
    }

    async rerunCheck(taskId: string, kind: "SPELL" | "QC", whitelist: string[], actor?: Actor) {
        const task = await this.getOne(taskId);
        this.assertCanAccess(task, actor);

        const record = await this.repository.findOne({ where: { taskId } });
        if (!record) throw this.httpError("Không tìm thấy kết quả kiểm tra", 404);
        if (record.finalizedAt) throw this.httpError("Đã chốt kiểm tra, không thể kiểm tra lại", 409);
        if (record.status === TaskResultCheckStatus.RUNNING) throw this.httpError("Đang kiểm tra, vui lòng chờ", 409);
        if (!record.filteredFileUrl) throw this.httpError("Không có file để kiểm tra lại", 400);

        const update: Record<string, any> = { status: TaskResultCheckStatus.RUNNING };
        if (kind === "SPELL") update.reviewerWhitelist = whitelist;
        await this.repository.update(record.id, update);

        this.runRerun(record.id, task, record, kind, whitelist, actor).catch(async (err: any) => {
            await this.repository.update(record.id, {
                status: TaskResultCheckStatus.ERROR,
                errorMessage: err?.message || "Lỗi không xác định khi kiểm tra lại"
            });
        });

        return { status: TaskResultCheckStatus.RUNNING };
    }

    private async runRerun(recordId: string, task: Tasks, record: TaskResultChecks, kind: "SPELL" | "QC", whitelist: string[], actor?: Actor) {
        const buffer = await fetchRemoteFile(record.filteredFileUrl as string);
        const fileName = (task.result as any)?.name || `${task.id}.xlsx`;
        const sheetNames = record.sheetNames || [];

        const checked = kind === "SPELL"
            ? await this.executeSpellCheck(buffer, fileName, sheetNames, whitelist)
            : await this.executeQcCheck(buffer, fileName, sheetNames, task.project?.id, actor);

        await this.repository.update(recordId, {
            status: TaskResultCheckStatus.DONE,
            ...checked
        });
    }

    async finalize(taskId: string, actor?: Actor) {
        const task = await this.getOne(taskId);
        this.assertCanAccess(task, actor);

        const record = await this.repository.findOne({ where: { taskId } });
        if (!record) throw this.httpError("Không tìm thấy kết quả kiểm tra", 404);
        if (record.status !== TaskResultCheckStatus.DONE) throw this.httpError("Kiểm tra chưa hoàn tất", 409);

        record.finalizedAt = new Date();
        return await this.repository.save(record);
    }

    async buildPdf(taskId: string, actor?: Actor): Promise<Buffer> {
        const task = await this.getOne(taskId);
        this.assertCanAccess(task, actor);

        const record = await this.repository.findOne({ where: { taskId } });
        if (!record) throw this.httpError("Không tìm thấy kết quả kiểm tra", 404);

        const spellItems = (record.reviewedSpellErrors || []).filter(i => i.confirmed);
        const qcItems = (record.reviewedQcMismatches || []).filter(i => i.confirmed);

        const spellGroups = groupSpellErrors(spellItems);
        const qcGroups = groupQcMismatches(qcItems);

        return await new Promise((resolve, reject) => {
            const doc = new PDFDocument({ margin: 40, bufferPages: true, size: "A4" });
            doc.registerFont("Base", FONT_REGULAR);
            doc.registerFont("Base-Bold", FONT_BOLD);
            doc.font("Base");

            const chunks: Buffer[] = [];
            doc.on("data", (c: Buffer) => chunks.push(c));
            doc.on("end", () => resolve(Buffer.concat(chunks)));
            doc.on("error", reject);

            const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
            const x = doc.page.margins.left;

            doc.font("Base-Bold").fontSize(18).fillColor("#1e293b").text("Báo cáo kiểm tra kết quả công việc", { align: "center" });
            doc.font("Base").fontSize(9).fillColor("#94a3b8").text(`Xuất lúc ${new Date().toLocaleString("vi-VN")}`, { align: "center" });
            doc.moveDown(1.2);

            doc.rect(x, doc.y, 6, 16).fill("#2563eb");
            doc.font("Base-Bold").fontSize(13).fillColor("#1e293b").text(`  Lỗi chính tả đã xác nhận (${spellItems.length} lỗi, ${spellGroups.length} loại)`, x + 10, doc.y - 14);
            doc.moveDown(0.8);

            if (spellGroups.length === 0) {
                doc.font("Base").fontSize(10).fillColor("#64748b").text("Không có lỗi được xác nhận");
                doc.moveDown();
            } else {
                const spellColumns = [
                    { header: "Từ lỗi", width: contentWidth * 0.25 },
                    { header: "Số lần", width: contentWidth * 0.12 },
                    { header: "Vị trí", width: contentWidth * 0.63 }
                ];
                const spellRows = spellGroups.map(g => [g.token, String(g.count), g.locations.join(", ")]);
                const endY = drawTable(doc, { x, y: doc.y, columns: spellColumns, rows: spellRows, headerColor: "#2563eb" });
                doc.y = endY + 18;
            }

            doc.rect(x, doc.y, 6, 16).fill("#ea580c");
            doc.font("Base-Bold").fontSize(13).fillColor("#1e293b").text(`  Điểm QC chưa khớp đã xác nhận (${qcItems.length} lỗi, ${qcGroups.length} thuộc tính)`, x + 10, doc.y - 14);
            doc.moveDown(0.8);

            if (qcGroups.length === 0) {
                doc.font("Base").fontSize(10).fillColor("#64748b").text("Không có điểm chưa khớp được xác nhận");
            } else {
                const qcColumns = [
                    { header: "Thuộc tính", width: contentWidth * 0.18 },
                    { header: "Sản phẩm", width: contentWidth * 0.27 },
                    { header: "Ghi -> Chuẩn", width: contentWidth * 0.25 },
                    { header: "Ghi chú", width: contentWidth * 0.3 }
                ];
                const qcRows = qcGroups.flatMap(group =>
                    group.items.map(item => [
                        group.attribute,
                        `${item.sheetPrefix}${item.productRef}`,
                        `${item.claimedValue} -> ${item.expectedValue}`,
                        item.reasoning || ""
                    ])
                );
                doc.y = drawTable(doc, { x, y: doc.y, columns: qcColumns, rows: qcRows, headerColor: "#ea580c" });
            }

            const range = doc.bufferedPageRange();
            for (let i = range.start; i < range.start + range.count; i++) {
                doc.switchToPage(i);
                doc.font("Base").fontSize(8).fillColor("#94a3b8").text(
                    `Trang ${i + 1 - range.start}/${range.count}`,
                    0,
                    doc.page.height - 30,
                    { align: "center" }
                );
            }

            doc.end();
        });
    }

    async buildXlsx(taskId: string, actor?: Actor): Promise<Buffer> {
        const task = await this.getOne(taskId);
        this.assertCanAccess(task, actor);

        const record = await this.repository.findOne({ where: { taskId } });
        if (!record) throw this.httpError("Không tìm thấy kết quả kiểm tra", 404);
        if (!record.filteredFileUrl) throw this.httpError("Không có file để xuất", 400);

        const buffer = await fetchRemoteFile(record.filteredFileUrl);
        const spellItems = (record.reviewedSpellErrors || []).filter(i => i.confirmed);
        const qcItems = (record.reviewedQcMismatches || []).filter(i => i.confirmed);

        return await buildHighlightedWorkbook(buffer, record.sheetNames || [], spellItems, qcItems);
    }
}

function groupSpellErrors(items: { token: string; location: string }[]) {
    const map = new Map<string, string[]>();
    for (const item of items) {
        const key = item.token;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(item.location);
    }
    return Array.from(map.entries()).map(([token, locations]) => ({
        token,
        count: locations.length,
        locations
    }));
}

function groupQcMismatches(items: Record<string, any>[]) {
    const map = new Map<string, { sheetPrefix: string; productRef: string; claimedValue: string; expectedValue: string; reasoning: string }[]>();
    for (const item of items) {
        const key = item.attribute || "Không xác định";
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push({
            sheetPrefix: item.sheet_name ? `${item.sheet_name} · ` : "",
            productRef: item.product_ref || "Không rõ sản phẩm",
            claimedValue: item.claimed_value,
            expectedValue: item.expected_value ?? "không tìm thấy",
            reasoning: item.reasoning || ""
        });
    }
    return Array.from(map.entries()).map(([attribute, entries]) => ({
        attribute,
        count: entries.length,
        items: entries
    }));
}
