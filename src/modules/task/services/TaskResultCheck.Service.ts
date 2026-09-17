import axios from "axios";
import path from "path";
import PDFDocument from "pdfkit";
import { AppDataSource } from "../../../data-source";
import { TaskResultChecks, TaskResultCheckStatus } from "../entities/TaskResultCheck.entity";
import { taskResultCheckEmitter, TASK_RESULT_CHECK_EVENTS } from "../events/TaskResultCheckEmitter";
import { SpellingCheckService } from "../../spelling-check/services/SpellingCheck.Service";
import { QcService } from "../../qc/services/Qc.Service";
import { ProjectSpellCheckWhitelistService } from "../../spelling-whitelist/services/ProjectSpellCheckWhitelist.Service";
import { filterWorkbookSheets } from "../../../shared/helpers/xlsxFilter.helper";
import { rawLocationToExcelRef } from "../../../shared/helpers/excelRef.helper";
import { buildHighlightedWorkbook } from "../../../shared/helpers/xlsxHighlight.helper";
import { drawTable } from "../../../shared/helpers/pdfTable.helper";
import { uploadBufferToCloudinary } from "../../../shared/helpers/cloudinary.helper";
import { isProjectManagementRole } from "../../account/entities/Account.entity";
import { TaskBaseService } from "./Task.BaseService";
import { Tasks } from "../entities/Task.entity";
import { Users } from "../../user/entities/User.entity";
import { MemberRole } from "../../project/entities/TeamMember.entity";

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
    console.log(`[RESULT_CHECK_DEBUG] fetchRemoteFile(scan) url=${fileUrl} content-type=${res.headers?.["content-type"]} bytes=${res.data?.length} at=${new Date().toISOString()}`);
    return Buffer.from(res.data);
}

export class TaskResultCheckService extends TaskBaseService {
    private repository = AppDataSource.getRepository(TaskResultChecks);
    private spellingCheckService = new SpellingCheckService();
    private qcService = new QcService();
    private whitelistService = new ProjectSpellCheckWhitelistService();

    private async mergeProjectWhitelist(projectId: string | undefined, whitelist: string[], actor?: Actor) {
        if (!projectId) return whitelist;
        const projectWords = await this.whitelistService.getWords(projectId, actor as any);
        const merged = new Set(whitelist);
        for (const entry of projectWords) merged.add(entry.word);
        return Array.from(merged);
    }

    private canReviewChecks(task: Tasks, actor?: Actor) {
        const actorUserId = this.getActorUserId(actor);
        return isProjectManagementRole(actor?.role)
            || this.isProjectOperatorFromTeam(task.project?.team, actor)
            || task.assignerId === actorUserId;
    }

    private canViewChecks(task: Tasks, actor?: Actor) {
        const actorUserId = this.getActorUserId(actor);
        return this.canReviewChecks(task, actor) || task.assigneeId === actorUserId;
    }

    private assertCanAccess(task: Tasks, actor?: Actor) {
        if (!this.canViewChecks(task, actor)) throw this.httpError("Bạn không có quyền xem thông tin kiểm tra của công việc này", 403);
    }

    private assertCanReview(task: Tasks, actor?: Actor) {
        if (!this.canReviewChecks(task, actor)) throw this.httpError("Bạn không có quyền chốt kiểm tra của công việc này", 403);
    }

    private reviewerRecipients(task: Tasks): Users[] {
        const map = new Map<string, Users>();
        if (task.project?.team?.teamLead) map.set(task.project.team.teamLead.id, task.project.team.teamLead);
        if (task.supervisor) map.set(task.supervisor.id, task.supervisor);
        if (task.assigner) map.set(task.assigner.id, task.assigner);
        for (const member of task.project?.team?.members || []) {
            if (member.role === MemberRole.PROJECT_MANAGER && member.user) map.set(member.user.id, member.user);
        }
        return Array.from(map.values());
    }

    async startForSubmission(params: {
        taskId: string;
        projectId?: string;
        fileBuffer?: Buffer;
        fileUrl?: string;
        fileName: string;
        sheetNames: string[];
        whitelist: string[];
        scenarioIds?: string[];
        actor?: Actor;
    }) {
        const ext = getExt(params.fileName || "");
        if (params.sheetNames.length === 0 && params.scenarioIds && params.scenarioIds.length > 0) {
            const derived = Array.from(new Set(params.scenarioIds.map(id => id.split("::")[0]).filter(Boolean)));
            params.sheetNames = derived;
        }
        if (!SHEET_EXTENSIONS.includes(ext) || params.sheetNames.length === 0) {
            console.log(`[RESULT_CHECK_DEBUG] startForSubmission BO QUA quet (khong tao record) taskId=${params.taskId} fileName=${params.fileName} ext=${ext} sheetNames=${JSON.stringify(params.sheetNames)} scenarioIds=${JSON.stringify(params.scenarioIds)}`);
            const deleted = await this.repository.delete({ taskId: params.taskId });
            if (deleted.affected) taskResultCheckEmitter.emit(TASK_RESULT_CHECK_EVENTS.UPDATED, { taskId: params.taskId });
            return;
        }
        console.log(`[RESULT_CHECK_DEBUG] startForSubmission BAT DAU quet taskId=${params.taskId} fileUrl=${params.fileUrl || "(buffer)"} fileName=${params.fileName} sheetNames=${JSON.stringify(params.sheetNames)} scenarioIds=${JSON.stringify(params.scenarioIds)}`);

        await this.repository.delete({ taskId: params.taskId });
        let record = this.repository.create({
            taskId: params.taskId,
            status: TaskResultCheckStatus.RUNNING,
            spellStatus: TaskResultCheckStatus.RUNNING,
            qcStatus: TaskResultCheckStatus.RUNNING,
            sheetNames: params.sheetNames,
            scenarioIds: params.scenarioIds && params.scenarioIds.length > 0 ? params.scenarioIds : null
        });
        record = await this.repository.save(record);
        taskResultCheckEmitter.emit(TASK_RESULT_CHECK_EVENTS.UPDATED, { taskId: params.taskId });

        this.run(record.id, params).catch(async (err: any) => {
            const message = err?.message || "Lỗi không xác định khi kiểm tra kết quả";
            await this.repository.update(record.id, {
                status: TaskResultCheckStatus.ERROR,
                errorMessage: message,
                spellStatus: TaskResultCheckStatus.ERROR,
                spellErrorMessage: message,
                qcStatus: TaskResultCheckStatus.ERROR,
                qcErrorMessage: message
            });
            taskResultCheckEmitter.emit(TASK_RESULT_CHECK_EVENTS.UPDATED, { taskId: params.taskId });
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
        scenarioIds?: string[];
        actor?: Actor;
    }) {
        let buffer = params.fileBuffer;
        if (!buffer && params.fileUrl) buffer = await fetchRemoteFile(params.fileUrl);
        if (!buffer) throw new Error("Không có dữ liệu file để kiểm tra");
        console.log(`[RESULT_CHECK_DEBUG] run() recordId=${recordId} raw buffer bytes=${buffer.length} sheetNames=${JSON.stringify(params.sheetNames)}`);

        const filteredBuffer = filterWorkbookSheets(buffer, params.sheetNames);
        console.log(`[RESULT_CHECK_DEBUG] run() recordId=${recordId} filtered buffer bytes=${filteredBuffer.length}`);
        const uploaded = await uploadBufferToCloudinary(filteredBuffer, params.fileName, `GETVINI/ERP/TASK/${params.taskId}/CHECKS`);

        await this.repository.update(recordId, {
            filteredFileUrl: uploaded.url,
            fileName: params.fileName
        });

        const mergedWhitelist = await this.mergeProjectWhitelist(params.projectId, params.whitelist, params.actor);

        await Promise.all([
            this.runSpellCheck(recordId, params.taskId, filteredBuffer, params.fileName, params.sheetNames, mergedWhitelist, params.scenarioIds),
            this.runQcCheck(recordId, params.taskId, filteredBuffer, params.fileName, params.sheetNames, params.scenarioIds, params.projectId, params.actor)
        ]);

        const finalRecord = await this.repository.findOne({ where: { id: recordId } });
        const overallStatus = finalRecord?.spellStatus === TaskResultCheckStatus.DONE && finalRecord?.qcStatus === TaskResultCheckStatus.DONE
            ? TaskResultCheckStatus.DONE
            : TaskResultCheckStatus.ERROR;
        await this.repository.update(recordId, { status: overallStatus });

        const task = await this.getOne(params.taskId);
        await this.notifyRawScanDone(task, finalRecord?.reviewedSpellErrors || [], finalRecord?.reviewedQcMismatches || []);
    }

    private async runSpellCheck(
        recordId: string,
        taskId: string,
        buffer: Buffer,
        fileName: string,
        sheetNames: string[],
        whitelist: string[],
        scenarioIds?: string[]
    ) {
        try {
            const spell = await this.executeSpellCheck(buffer, fileName, sheetNames, whitelist, scenarioIds);
            console.log(`[RESULT_CHECK_DEBUG] executeSpellCheck OK recordId=${recordId} requested_scenarioIds=${JSON.stringify(scenarioIds)} spellErrors=${spell.spellErrors?.length ?? 0} scannedScenarios=${spell.scannedScenarios?.length ?? 0}`);
            await this.repository.update(recordId, { ...spell, spellStatus: TaskResultCheckStatus.DONE, spellErrorMessage: null });
        } catch (err: any) {
            console.log(`[RESULT_CHECK_DEBUG] executeSpellCheck LOI recordId=${recordId} status=${err?.response?.status} detail=${JSON.stringify(err?.response?.data)} message=${err?.message}`);
            await this.repository.update(recordId, {
                spellStatus: TaskResultCheckStatus.ERROR,
                spellErrorMessage: err?.message || "Lỗi khi kiểm tra chính tả"
            });
        }
        taskResultCheckEmitter.emit(TASK_RESULT_CHECK_EVENTS.UPDATED, { taskId });
    }

    private async runQcCheck(
        recordId: string,
        taskId: string,
        buffer: Buffer,
        fileName: string,
        sheetNames: string[],
        scenarioIds: string[] | undefined,
        projectId: string | undefined,
        actor?: Actor
    ) {
        try {
            const qc = await this.executeQcCheck(buffer, fileName, sheetNames, scenarioIds, projectId, actor);
            console.log(`[RESULT_CHECK_DEBUG] executeQcCheck OK recordId=${recordId} projectId=${projectId} requested_scenarioIds=${JSON.stringify(scenarioIds)} qcMismatches=${qc.qcMismatches?.length ?? 0}`);
            await this.repository.update(recordId, { ...qc, qcStatus: TaskResultCheckStatus.DONE, qcErrorMessage: null });
        } catch (err: any) {
            console.log(`[RESULT_CHECK_DEBUG] executeQcCheck LOI recordId=${recordId} status=${err?.response?.status} detail=${JSON.stringify(err?.response?.data)} message=${err?.message}`);
            await this.repository.update(recordId, {
                qcStatus: TaskResultCheckStatus.ERROR,
                qcErrorMessage: err?.message || "Lỗi khi kiểm tra QC"
            });
        }
        taskResultCheckEmitter.emit(TASK_RESULT_CHECK_EVENTS.UPDATED, { taskId });
    }

    private async notifyRawScanDone(task: Tasks, spellErrors: any[], qcMismatches: Record<string, any>[]) {
        const summary = buildCheckSummary(spellErrors, qcMismatches);
        if (!summary) return;

        for (const recipient of this.reviewerRecipients(task)) {
            await this.notificationService.createNotification({
                title: "Kết quả quét chính tả/QC (chưa chốt)",
                content: `Công việc "${task.nickname || task.name}" của dự án ${task.project?.name} vừa quét xong, vui lòng rà soát và chốt lỗi:\n${summary}`,
                type: "TASK_RESULT_CHECK_RAW",
                recipient,
                relatedEntityId: task.id.toString(),
                relatedEntityType: "Task",
                link: `/tasks/${task.id}`
            });
        }
    }

    private async notifyFinalized(task: Tasks, spellErrors: any[], qcMismatches: Record<string, any>[]) {
        const summary = buildCheckSummary(spellErrors, qcMismatches);
        if (!summary) return;

        const recipients = new Map<string, Users>();
        if (task.assignee) recipients.set(task.assignee.id, task.assignee);
        for (const reviewer of this.reviewerRecipients(task)) recipients.set(reviewer.id, reviewer);

        for (const recipient of recipients.values()) {
            await this.notificationService.createNotification({
                title: "Kết quả kiểm tra chính tả/QC đã chốt",
                content: `Công việc "${task.nickname || task.name}" của dự án ${task.project?.name} đã chốt kết quả kiểm tra:\n${summary}`,
                type: "TASK_RESULT_CHECK_DONE",
                recipient,
                relatedEntityId: task.id.toString(),
                relatedEntityType: "Task",
                link: `/tasks/${task.id}`
            });
        }
    }

    private async executeSpellCheck(
        buffer: Buffer,
        fileName: string,
        sheetNames: string[],
        whitelist: string[],
        scenarioIds?: string[]
    ) {
        const spellJob = await this.spellingCheckService.start(
            buffer,
            fileName,
            "both",
            sheetNames.join(","),
            whitelist.join(","),
            scenarioIds && scenarioIds.length > 0 ? scenarioIds.join(",") : undefined
        );
        const { errors: spellErrors, scannedScenarios } = await this.pollSpellJob(spellJob.job_id);

        const spellErrorsWithId = spellErrors.map((e: any, idx: number) => ({
            id: `spell-${idx}`,
            location: rawLocationToExcelRef(e.location),
            token: e.token,
            sheetName: e.sheet || null,
            scenarioLabel: e.scenario || null,
            scenarioId: e.scenarioId || null
        }));
        const reviewedSpellErrors = spellErrorsWithId.map(e => ({ ...e, confirmed: true }));

        return { spellErrors: spellErrorsWithId, reviewedSpellErrors, scannedScenarios };
    }

    private async executeQcCheck(
        buffer: Buffer,
        fileName: string,
        sheetNames: string[],
        scenarioIds?: string[],
        projectId?: string,
        actor?: Actor
    ) {
        let qcMismatches: Record<string, any>[] = [];
        let qcModels: { extract: string; verify: string } | null = null;
        if (projectId) {
            try {
                const qcResult = await this.qcService.run({
                    fileBuffer: buffer,
                    fileName,
                    sheetNames,
                    projectId,
                    scenarioIds,
                    actor: actor as any
                });
                qcMismatches = qcResult?.mismatch_report?.mismatches || [];
                qcModels = qcResult?.models || null;
            } catch (err: any) {
                if (err?.statusCode === 400) {
                    console.log(`[RESULT_CHECK_DEBUG] executeQcCheck: AI service tra ve 400, QC bi coi la 0 mismatch (AN LOI THUC SU) message=${err?.message}`);
                    qcMismatches = [];
                } else {
                    throw new Error(err?.response?.data?.detail || err?.message || "Không thể chạy QC do lỗi máy chủ AI service");
                }
            }
        }

        const reviewedQcMismatches = qcMismatches.map((m: any, idx: number) => ({
            ...m,
            id: `qc-${idx}`,
            confirmed: m.status !== "unresolved"
        }));

        return { qcMismatches, reviewedQcMismatches, qcModels };
    }

    private async pollSpellJob(jobId: string): Promise<{ errors: any[]; scannedScenarios: any[] }> {
        const maxAttempts = 200;
        for (let i = 0; i < maxAttempts; i++) {
            const status = await this.spellingCheckService.getStatus(jobId);
            if (status.status === "done") return { errors: status.errors || [], scannedScenarios: status.scanned_scenarios || [] };
            if (status.status === "error") throw new Error(status.error || "Lỗi khi kiểm tra chính tả");
            await new Promise(resolve => setTimeout(resolve, 1500));
        }
        throw new Error("Kiểm tra chính tả quá thời gian chờ");
    }

    async getForTask(taskId: string, actor?: Actor) {
        const task = await this.getOne(taskId);
        this.assertCanAccess(task, actor);
        const record = await this.repository.findOne({ where: { taskId } });
        if (!record) return record;

        const canReview = this.canReviewChecks(task, actor);
        if (canReview) {
            record.reviewerWhitelist = await this.mergeProjectWhitelist(
                task.project?.id,
                record.reviewerWhitelist || [],
                actor
            );
            return { ...record, canReview: true };
        }

        const base = {
            id: record.id,
            taskId: record.taskId,
            status: record.status,
            spellStatus: record.spellStatus,
            qcStatus: record.qcStatus,
            finalizedAt: record.finalizedAt,
            canReview: false
        };

        if (!record.finalizedAt) {
            return { ...base, reviewedSpellErrors: [], reviewedQcMismatches: [] };
        }

        return {
            ...base,
            qcModels: record.qcModels,
            reviewedSpellErrors: (record.reviewedSpellErrors || []).filter(i => i.confirmed),
            reviewedQcMismatches: (record.reviewedQcMismatches || []).filter(i => i.confirmed)
        };
    }

    async toggleItem(taskId: string, kind: "SPELL" | "QC", itemId: string, confirmed: boolean, actor?: Actor) {
        return this.toggleItems(taskId, kind, [itemId], confirmed, actor);
    }

    async toggleItems(taskId: string, kind: "SPELL" | "QC", itemIds: string[], confirmed: boolean, actor?: Actor) {
        const task = await this.getOne(taskId);
        this.assertCanReview(task, actor);

        const saved = await AppDataSource.transaction(async (manager) => {
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

        if (kind === "SPELL" && !confirmed && task.project?.id) {
            const dismissedTokens = (saved.reviewedSpellErrors || [])
                .filter(item => itemIds.includes(item.id))
                .map(item => item.token)
                .filter(Boolean);
            if (dismissedTokens.length > 0) {
                await this.whitelistService.addWords(task.project.id, dismissedTokens, actor as any);
            }
        }

        taskResultCheckEmitter.emit(TASK_RESULT_CHECK_EVENTS.UPDATED, { taskId });

        return saved;
    }

    async rerunCheck(taskId: string, kind: "SPELL" | "QC", whitelist: string[], actor?: Actor) {
        const task = await this.getOne(taskId);
        this.assertCanReview(task, actor);

        const record = await this.repository.findOne({ where: { taskId } });
        if (!record) throw this.httpError("Không tìm thấy kết quả kiểm tra", 404);
        if (record.finalizedAt) throw this.httpError("Đã chốt kiểm tra, không thể kiểm tra lại", 409);
        const currentStatus = kind === "SPELL" ? record.spellStatus : record.qcStatus;
        if (currentStatus === TaskResultCheckStatus.RUNNING) throw this.httpError("Đang kiểm tra, vui lòng chờ", 409);
        if (!record.filteredFileUrl) throw this.httpError("Không có file để kiểm tra lại", 400);

        const update: Record<string, any> = kind === "SPELL"
            ? { spellStatus: TaskResultCheckStatus.RUNNING, spellErrorMessage: null, reviewerWhitelist: whitelist }
            : { qcStatus: TaskResultCheckStatus.RUNNING, qcErrorMessage: null };
        await this.repository.update(record.id, update);
        taskResultCheckEmitter.emit(TASK_RESULT_CHECK_EVENTS.UPDATED, { taskId });

        this.runRerun(record.id, task, record, kind, whitelist, actor);

        return { status: TaskResultCheckStatus.RUNNING };
    }

    private async runRerun(recordId: string, task: Tasks, record: TaskResultChecks, kind: "SPELL" | "QC", whitelist: string[], actor?: Actor) {
        let buffer: Buffer;
        try {
            buffer = await fetchRemoteFile(record.filteredFileUrl as string);
        } catch (err: any) {
            const field = kind === "SPELL" ? "spellStatus" : "qcStatus";
            const errField = kind === "SPELL" ? "spellErrorMessage" : "qcErrorMessage";
            await this.repository.update(recordId, {
                [field]: TaskResultCheckStatus.ERROR,
                [errField]: err?.message || "Không tải được file để kiểm tra lại"
            });
            taskResultCheckEmitter.emit(TASK_RESULT_CHECK_EVENTS.UPDATED, { taskId: task.id });
            return;
        }

        const fileName = record.fileName || (task.result as any)?.name || `${task.id}.xlsx`;
        const sheetNames = record.sheetNames || [];
        const scenarioIds = record.scenarioIds || undefined;

        if (kind === "SPELL") {
            const mergedWhitelist = await this.mergeProjectWhitelist(task.project?.id, whitelist, actor);
            await this.runSpellCheck(recordId, task.id, buffer, fileName, sheetNames, mergedWhitelist, scenarioIds);
        } else {
            await this.runQcCheck(recordId, task.id, buffer, fileName, sheetNames, scenarioIds, task.project?.id, actor);
        }
    }

    async finalize(taskId: string, actor?: Actor) {
        const task = await this.getOne(taskId);
        this.assertCanReview(task, actor);

        const record = await this.repository.findOne({ where: { taskId } });
        if (!record) throw this.httpError("Không tìm thấy kết quả kiểm tra", 404);
        if (record.spellStatus !== TaskResultCheckStatus.DONE || record.qcStatus !== TaskResultCheckStatus.DONE) {
            throw this.httpError("Chính tả và QC phải kiểm tra xong không lỗi trước khi chốt", 409);
        }

        record.finalizedAt = new Date();
        const saved = await this.repository.save(record);

        taskResultCheckEmitter.emit(TASK_RESULT_CHECK_EVENTS.UPDATED, { taskId });
        await this.notifyFinalized(task, record.reviewedSpellErrors || [], record.reviewedQcMismatches || []);

        return saved;
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
                    { header: "Sheet / Kịch bản", width: contentWidth * 0.28 },
                    { header: "Từ lỗi", width: contentWidth * 0.20 },
                    { header: "Số lần", width: contentWidth * 0.10 },
                    { header: "Vị trí", width: contentWidth * 0.42 }
                ];
                const spellRows = spellGroups.map(g => [
                    g.sheetName ? `${g.sheetName}${g.scenarioLabel ? ` / ${g.scenarioLabel}` : ""}` : "-",
                    g.token,
                    String(g.count),
                    g.locations.join(", ")
                ]);
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

export function buildCheckSummary(spellErrors: any[], qcMismatches: Record<string, any>[]): string | null {
    const confirmedSpell = (spellErrors || []).filter(e => e.confirmed !== false);
    const confirmedQc = (qcMismatches || []).filter(m => m.status !== "unresolved" && m.confirmed !== false);
    if (confirmedSpell.length === 0 && confirmedQc.length === 0) return null;

    const sheetOrder: string[] = [];
    const sheets = new Map<string, { scenarioOrder: string[]; scenarios: Map<string, { spell: number; qc: number }> }>();

    const ensure = (sheet: string, scenario: string) => {
        if (!sheets.has(sheet)) {
            sheets.set(sheet, { scenarioOrder: [], scenarios: new Map() });
            sheetOrder.push(sheet);
        }
        const entry = sheets.get(sheet)!;
        if (!entry.scenarios.has(scenario)) {
            entry.scenarios.set(scenario, { spell: 0, qc: 0 });
            entry.scenarioOrder.push(scenario);
        }
        return entry.scenarios.get(scenario)!;
    };

    for (const e of confirmedSpell) {
        ensure(e.sheetName || "Không rõ sheet", e.scenarioLabel || "Chung").spell += 1;
    }
    for (const m of confirmedQc) {
        ensure(m.sheet_name || m.sheet || "Không rõ sheet", m.scenario || "Chung").qc += 1;
    }

    const lines: string[] = [];
    for (const sheet of sheetOrder) {
        const entry = sheets.get(sheet)!;
        const multi = entry.scenarioOrder.length > 1;
        if (multi) lines.push(`${sheet}:`);
        for (const scenario of entry.scenarioOrder) {
            const stat = entry.scenarios.get(scenario)!;
            const label = multi
                ? `  • ${scenario === "Chung" ? "Toàn sheet" : scenario}`
                : `${sheet}${scenario === "Chung" ? "" : ` - ${scenario}`}`;
            lines.push(`${label}: ${stat.spell} lỗi chính tả, ${stat.qc} điểm QC chưa khớp`);
        }
    }

    return lines.join("\n");
}

function groupSpellErrors(items: { token: string; location: string; sheetName?: string | null; scenarioLabel?: string | null; scenarioId?: string | null }[]) {
    const map = new Map<string, { token: string; sheetName: string | null; scenarioLabel: string | null; locations: string[] }>();
    for (const item of items) {
        const sheetName = item.sheetName || null;
        const scenarioLabel = item.scenarioLabel || null;
        const key = `${sheetName || ""}|${item.scenarioId || scenarioLabel || ""}|${item.token}`;
        if (!map.has(key)) map.set(key, { token: item.token, sheetName, scenarioLabel, locations: [] });
        map.get(key)!.locations.push(item.location);
    }
    return Array.from(map.values()).map(g => ({
        token: g.token,
        sheetName: g.sheetName,
        scenarioLabel: g.scenarioLabel,
        count: g.locations.length,
        locations: g.locations
    }));
}

function groupQcMismatches(items: Record<string, any>[]) {
    const map = new Map<string, { sheetPrefix: string; productRef: string; claimedValue: string; expectedValue: string; reasoning: string }[]>();
    for (const item of items) {
        const key = item.attribute || "Không xác định";
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push({
            sheetPrefix: item.sheet_name ? `${item.sheet_name}${item.scenario ? ` / ${item.scenario}` : ""} · ` : "",
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