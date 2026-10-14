import { AppDataSource } from "../../../data-source";
import { EntityManager, In, IsNull } from "typeorm";
import {
    PaymentRequests,
    PaymentRequestType,
    PaymentRequestApprovalStatus,
    PaymentDueStatus,
    PaymentMethod,
    CashVoucherInfo,
    PaymentRequestFile,
    PaymentRequestHistoryEntry,
    PaymentSettlementStatus,
    PaymentTransactionRecord
} from "../entities/PaymentRequest.entity";
import { Tasks } from "../../task/entities/Task.entity";
import { Users } from "../../user/entities/User.entity";
import { Projects } from "../../project/entities/Project.entity";
import { UserRole } from "../../account/entities/Account.entity";
import { NotificationService } from "../../notification/services/Notification.Service";
import { GoogleSheetService, PaymentRequestSheetRow } from "../../../shared/services/GoogleSheet.Service";
import { PaymentRequestDocumentService, FillPaymentRequestDocInput } from "./PaymentRequestDocument.Service";
import { readMoneyToWords } from "../../../shared/utils/numberToWordsVi";
import { getGoogleConfig, getGoogleSheetsClient } from "../../../shared/config/google";
import { uploadToCloudinary } from "../../../shared/helpers/cloudinary.helper";
import crypto from "crypto";

const DUE_SOON_DAYS = 3;

// Vai trò duyệt vòng 1 (Admin Sale) + các vai trò luôn được coi là có quyền duyệt/xem toàn bộ
const REVIEWER_NOTIFY_ROLES: UserRole[] = [UserRole.ADMIN_SALE, UserRole.ADMIN];
const BOD_NOTIFY_ROLES: UserRole[] = [UserRole.BOD, UserRole.ADMIN];

/**
 * Giả định vai trò Kế toán / Kiểm soát tài chính trong hệ thống Getvini ERP:
 * Hiện tại hệ thống phân quyền phân công ADMIN_SALE làm bộ phận Kế toán / Kiểm soát thanh toán,
 * cùng với BOD (Ban giám đốc) và ADMIN (Quản trị hệ thống) có toàn quyền tài chính.
 */
export const ACCOUNTANT_ROLES: UserRole[] = [UserRole.ADMIN_SALE, UserRole.ADMIN, UserRole.BOD];

export interface PaymentRequestQuery {
    search?: string;
    type?: PaymentRequestType;
    approvalStatus?: PaymentRequestApprovalStatus;
    paymentStatus?: PaymentDueStatus;
    settlementStatus?: PaymentSettlementStatus;
    projectId?: string;
    fromDate?: string;
    toDate?: string;
    dateField?: "dueDate" | "createdAt";
    minAmount?: number | string;
    maxAmount?: number | string;
    sortBy?: "createdAt" | "amount" | "dueDate";
    sortOrder?: "ASC" | "DESC";
}

export interface PaymentRequestViewer {
    userId: string;
    role: string;
}

export interface RecordPaymentDTO {
    paidAmountThisTime?: number | string;
    paymentMethod: PaymentMethod | string;
    cashVoucherInfo?: CashVoucherInfo;
    paymentProofs?: PaymentRequestFile[];
    note?: string;
}

export interface SubmitSettlementDTO {
    settledAmount: number | string;
    settlementFiles?: PaymentRequestFile[];
    settlementNote?: string;
}

export interface ApproveSettlementDTO {
    note?: string;
    refundConfirmed?: boolean;
    refundPaymentMethod?: string;
    refundProofFiles?: PaymentRequestFile[];
}

// Vai trò được xem toàn bộ yêu cầu thanh toán (không giới hạn theo người tạo)
const FULL_VISIBILITY_ROLES: UserRole[] = [UserRole.ADMIN_SALE, UserRole.BOD, UserRole.ADMIN];

const canViewRequest = (request: PaymentRequests, viewer?: PaymentRequestViewer) => {
    if (!viewer) return true;
    if (FULL_VISIBILITY_ROLES.includes(viewer.role as UserRole)) return true;
    // Chi phí phát sinh do vendor: requesterId chính là người phân công task cho vendor
    // (xem createVendorExpense), nên chỉ cần so sánh requesterId là đủ để người phân công thấy.
    return request.requesterId === viewer.userId;
};

export const computePaymentStatus = (request: PaymentRequests): PaymentDueStatus => {
    // 1. Kiểm tra trạng thái từ chối hoặc hủy bỏ trước tiên
    if ([PaymentRequestApprovalStatus.REJECTED, PaymentRequestApprovalStatus.CANCELLED].includes(request.approvalStatus)) {
        return PaymentDueStatus.NOT_APPLICABLE;
    }

    // 2. Đã chi đủ 100% (bao gồm cả trường hợp chi bù sau quyết toán: paidAmount >= amount)
    const isFullyPaid = Math.round(Number(request.paidAmount || 0)) >= Math.round(Number(request.amount))
        || Boolean(request.paidAt)
        || request.paymentStatus === PaymentDueStatus.PAID;
    if (isFullyPaid) {
        return PaymentDueStatus.PAID;
    }

    // 3. Đã chi một phần (lũy kế > 0 nhưng chưa đạt 100%)
    const isPartiallyPaid = Math.round(Number(request.paidAmount || 0)) > 0 && Math.round(Number(request.paidAmount || 0)) < Math.round(Number(request.amount));
    if (isPartiallyPaid || request.paymentStatus === PaymentDueStatus.PARTIALLY_PAID) {
        return PaymentDueStatus.PARTIALLY_PAID;
    }

    // 4. Chưa được BOD phê duyệt
    if (request.approvalStatus !== PaymentRequestApprovalStatus.APPROVED) {
        return PaymentDueStatus.WAITING;
    }

    // 5. Đã duyệt, đang chờ chi tiền -> tính theo hạn thanh toán
    const effectiveDueDate = request.confirmedDueDate || request.dueDate;
    if (!effectiveDueDate) return PaymentDueStatus.WAITING;

    const dueDate = new Date(effectiveDueDate);
    const now = new Date();
    const diffDays = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return PaymentDueStatus.OVERDUE;
    if (diffDays <= DUE_SOON_DAYS) return PaymentDueStatus.DUE_SOON;
    return PaymentDueStatus.WAITING;
};

export const computeIsOverdue = (request: PaymentRequests): boolean => {
    // Không tính quá hạn nếu phiếu bị từ chối hoặc hủy bỏ
    if ([PaymentRequestApprovalStatus.REJECTED, PaymentRequestApprovalStatus.CANCELLED].includes(request.approvalStatus)) {
        return false;
    }
    // Không tính quá hạn nếu đã chi đủ
    const isFullyPaid = Math.round(Number(request.paidAmount || 0)) >= Math.round(Number(request.amount))
        || Boolean(request.paidAt)
        || request.paymentStatus === PaymentDueStatus.PAID;
    if (isFullyPaid) {
        return false;
    }
    const effectiveDueDate = request.confirmedDueDate || request.dueDate;
    if (!effectiveDueDate) return false;
    const dueDate = new Date(effectiveDueDate);
    const now = new Date();
    const diffDays = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return diffDays < 0;
};

export const computeSettlementStatus = (request: PaymentRequests): PaymentSettlementStatus => {
    if (request.type !== PaymentRequestType.ADVANCE) {
        return PaymentSettlementStatus.NOT_APPLICABLE;
    }
    if ([PaymentRequestApprovalStatus.REJECTED, PaymentRequestApprovalStatus.CANCELLED].includes(request.approvalStatus)) {
        return PaymentSettlementStatus.NOT_APPLICABLE;
    }
    return request.settlementStatus || PaymentSettlementStatus.PENDING;
};

const REVIEWER_ROLES: UserRole[] = [UserRole.ADMIN_SALE];

// Bỏ qua giá trị `type` không còn hợp lệ (vd client cũ còn gửi VENDOR_EXPENSE) để không văng lỗi enum của Postgres.
const isValidRequestType = (value: unknown): value is PaymentRequestType =>
    Object.values(PaymentRequestType).includes(value as PaymentRequestType);

export class PaymentRequestService {
    private repo = AppDataSource.getRepository(PaymentRequests);
    private taskRepo = AppDataSource.getRepository(Tasks);
    private userRepo = AppDataSource.getRepository(Users);
    private notificationService = new NotificationService();

    private relations = ["project", "task", "vendor", "requester", "reviewer", "confirmedDueDateBy", "submittedToBodBy", "bodDecisionBy"];

    // Thêm một dòng lịch sử vào yêu cầu thanh toán (không lưu DB ở đây, chỉ mutate object truyền vào)
    private pushHistory(request: PaymentRequests, entry: Omit<PaymentRequestHistoryEntry, "at">) {
        request.history = [...(request.history || []), { ...entry, at: new Date().toISOString() }];
    }

    // Gửi thông báo tới tất cả user có 1 trong các role chỉ định (dùng để báo cho các bên liên quan: Admin Sale, BOD...)
    private async notifyRoles(roles: UserRole[], data: {
        title: string;
        content: string;
        type: string;
        link?: string;
        relatedEntityId?: string;
        excludeUserId?: string;
    }, manager?: EntityManager) {
        const userRepo = manager ? manager.getRepository(Users) : this.userRepo;
        const users = await userRepo.find({ where: { accounts: { role: In(roles) } }, relations: ["accounts"] });
        for (const user of users) {
            if (data.excludeUserId && user.id === data.excludeUserId) continue;
            await this.notificationService.createNotification({
                title: data.title,
                content: data.content,
                type: data.type,
                recipient: user,
                relatedEntityId: data.relatedEntityId,
                relatedEntityType: "PaymentRequests",
                link: data.link
            }, manager);
        }
    }

    // Gửi thông báo tới 1 người dùng cụ thể (thường là người tạo yêu cầu)
    private async notifyUser(userId: string | null | undefined, data: {
        title: string;
        content: string;
        type: string;
        link?: string;
        relatedEntityId?: string;
    }, manager?: EntityManager) {
        if (!userId) return;
        const userRepo = manager ? manager.getRepository(Users) : this.userRepo;
        const user = await userRepo.findOne({ where: { id: userId } });
        if (!user) return;
        await this.notificationService.createNotification({
            title: data.title,
            content: data.content,
            type: data.type,
            recipient: user,
            relatedEntityId: data.relatedEntityId,
            relatedEntityType: "PaymentRequests",
            link: data.link
        }, manager);
    }

    /**
     * Phương án B (Auto-increment chống trùng khi lưu):
     * Khi phát hiện trong hệ thống cùng ngày (ddMMyy) và cùng dự án đã có số _14,
     * backend sẽ tự động đẩy người tạo sau lên số _15.
     */
    async resolveUniqueVoucherNo(
        docInput: FillPaymentRequestDocInput,
        projectId?: string | null
    ): Promise<FillPaymentRequestDocInput> {
        if (!docInput) return docInput;
        const docService = new PaymentRequestDocumentService();
        const reqDate = docService.parseDateParts(docInput.requestDate);
        const datePrefix = `${reqDate.dd}${reqDate.mm}${reqDate.yy}`; // Ví dụ: 131026

        const requestedVoucherNoStr = docInput.voucherNo ? String(docInput.voucherNo).trim() : "01";
        const requestedVoucherNum = parseInt(requestedVoucherNoStr.replace(/\D/g, ""), 10) || 1;

        // Quét các PaymentRequests cùng projectId (hoặc ngoài dự án)
        const qb = this.repo.createQueryBuilder("pr")
            .select(["pr.id", "pr.invoicePdfs", "pr.type", "pr.projectId", "pr.createdAt"]);

        if (projectId) {
            qb.where("pr.projectId = :projectId", { projectId });
        } else {
            qb.where("pr.projectId IS NULL");
        }

        const existingRequests = await qb.getMany();
        const existingNumbers = new Set<number>();

        const regexDatePattern = new RegExp(`^${datePrefix}_.*_DNTT-GETVINI_(\\d+)`, "i");
        const regexGeneralPattern = /_DNTT-GETVINI_(\d+)/i;

        for (const pr of existingRequests) {
            if (!Array.isArray(pr.invoicePdfs)) continue;
            for (const file of pr.invoicePdfs) {
                const namesToCheck = [
                    file.name,
                    (file as any).originalName,
                    (file as any).safeUploadName,
                    (file as any).standardName,
                    file.url
                ].filter(Boolean);

                for (const name of namesToCheck) {
                    const matchDate = name.match(regexDatePattern);
                    if (matchDate && matchDate[1]) {
                        existingNumbers.add(parseInt(matchDate[1], 10));
                    } else {
                        const matchGen = name.match(regexGeneralPattern);
                        if (matchGen && matchGen[1]) {
                            if (name.includes(datePrefix)) {
                                existingNumbers.add(parseInt(matchGen[1], 10));
                            }
                        }
                    }
                }

                if ((file as any).docData?.voucherNo) {
                    const fReqDate = docService.parseDateParts((file as any).docData.requestDate);
                    const fDatePrefix = `${fReqDate.dd}${fReqDate.mm}${fReqDate.yy}`;
                    if (fDatePrefix === datePrefix) {
                        const num = parseInt(String((file as any).docData.voucherNo).replace(/\D/g, ""), 10);
                        if (!isNaN(num)) {
                            existingNumbers.add(num);
                        }
                    }
                }
            }
        }

        // Nếu STT hiện tại đã tồn tại trong Set số đã dùng
        if (existingNumbers.has(requestedVoucherNum)) {
            const maxExisting = Math.max(...Array.from(existingNumbers), requestedVoucherNum);
            const nextNum = maxExisting + 1;
            const nextVoucherNoStr = String(nextNum).padStart(2, "0");

            console.log(`[resolveUniqueVoucherNo] Trùng STT ${requestedVoucherNoStr} cho ngày ${datePrefix} và dự án ${projectId || "NGOAI_DU_AN"}. Tự động đẩy lên STT ${nextVoucherNoStr}`);

            docInput.voucherNo = nextVoucherNoStr;

            // Cập nhật customFileName nếu có
            if (docInput.customFileName) {
                if (docInput.customFileName.includes(`_DNTT-GETVINI_${requestedVoucherNoStr}`)) {
                    docInput.customFileName = docInput.customFileName.replace(
                        `_DNTT-GETVINI_${requestedVoucherNoStr}`,
                        `_DNTT-GETVINI_${nextVoucherNoStr}`
                    );
                } else if (new RegExp(`_${requestedVoucherNoStr}(\\.[^.]+)?$`).test(docInput.customFileName)) {
                    docInput.customFileName = docInput.customFileName.replace(
                        new RegExp(`_${requestedVoucherNoStr}(\\.[^.]*)?$`),
                        `_${nextVoucherNoStr}$1`
                    );
                }
            }
        }

        return docInput;
    }

    private async processGeneratedDocs(
        invoicePdfs: any[],
        context?: { projectId?: string | null; projectName?: string }
    ): Promise<any[]> {
        if (!Array.isArray(invoicePdfs) || invoicePdfs.length === 0) return invoicePdfs || [];
        const result: any[] = [];
        const docService = new PaymentRequestDocumentService();

        for (const item of invoicePdfs) {
            if (item?.isGeneratedDoc && item?.docData) {
                try {
                    let docInput: FillPaymentRequestDocInput = {
                        voucherNo: item.docData.voucherNo,
                        requestDate: item.docData.requestDate,
                        requesterName: item.docData.requesterName,
                        position: item.docData.position,
                        department: item.docData.department,
                        amount: item.docData.amount,
                        amountInWords: item.docData.amountInWords,
                        reason: item.docData.reason,
                        dueDate: item.docData.dueDate,
                        projectName: item.docData.projectName || context?.projectName || "",
                        customFileName: item.docData.customFileName
                    };

                    // Tự động kiểm tra trùng STT và tăng lên số tiếp theo nếu trùng
                    docInput = await this.resolveUniqueVoucherNo(docInput, context?.projectId);
                    item.docData.voucherNo = docInput.voucherNo;
                    if (docInput.customFileName) {
                        item.docData.customFileName = docInput.customFileName;
                    }

                    const buffer = await docService.generateWordDocument(docInput);
                    const baseName = docService.generateStandardFileName(docInput);
                    const fileNameWithExt = `${baseName}.docx`;

                    let fileUrl = "";
                    let driveFileId: string | null = null;

                    // 1. Thử tải lên Google Drive trước (nếu Shared Drive được cấp quyền)
                    try {
                        const driveResult = await docService.generateAndUploadToDrive(docInput);
                        if (driveResult?.webViewLink) {
                            fileUrl = driveResult.webViewLink;
                            driveFileId = driveResult.driveFileId || null;
                        }
                    } catch (driveErr: any) {
                        console.warn("[processGeneratedDocs] Google Drive upload không khả dụng:", driveErr?.message);
                    }

                    // 2. Nếu Google Drive không trả về link (do giới hạn quota 0MB của Service Account cá nhân),
                    // tự động tải lên Cloudinary và cung cấp link xem trực tiếp qua Google Docs Viewer
                    if (!fileUrl) {
                        try {
                            const dummyFile: any = {
                                buffer,
                                originalname: fileNameWithExt,
                                mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                                size: buffer.length
                            };
                            const uploaded = await uploadToCloudinary(dummyFile, "ERP/PAYMENT_REQUESTS/documents");
                            if (uploaded?.url) {
                                fileUrl = `https://docs.google.com/viewer?url=${encodeURIComponent(uploaded.url)}`;
                            }
                        } catch (cloudErr: any) {
                            console.error("[processGeneratedDocs] Lỗi upload Cloudinary fallback:", cloudErr?.message);
                        }
                    }

                    result.push({
                        name: item.name || fileNameWithExt,
                        standardName: item.standardName || fileNameWithExt,
                        safeUploadName: fileNameWithExt,
                        originalName: fileNameWithExt,
                        url: fileUrl,
                        driveFileId: driveFileId,
                        fileType: "DOC",
                        docType: "PAYMENT_REQUEST_DOC",
                        size: buffer.length,
                        uploadedAt: new Date().toISOString(),
                        isGeneratedDoc: true,
                        docData: docInput
                    });
                    continue;
                } catch (err: any) {
                    console.error("[processGeneratedDocs] Lỗi xử lý tài liệu mẫu:", err?.message);
                }
            }

            if (item && typeof item === "object") {
                const { isGeneratedDoc, docData, ...rest } = item;
                result.push(rest);
            } else {
                result.push(item);
            }
        }
        return result;
    }

    async getServiceBudgetInfo(projectId: string, taskId: string, excludeRequestId?: string) {
        const task = await this.taskRepo.findOne({
            where: { id: taskId },
            relations: [
                "contractService",
                "contractService.service",
                "opportunityServiceJob",
                "opportunityServiceJob.opportunityService",
                "opportunityServiceJob.opportunityService.service"
            ]
        });
        if (!task) throw new Error("Không tìm thấy công việc");

        const contractService = task.contractService;
        const oppService = task.opportunityServiceJob?.opportunityService;
        const service = contractService?.service || oppService?.service;
        const serviceId = service?.id || contractService?.serviceId || oppService?.serviceId;
        const serviceName = service?.name || contractService?.name || "Dịch vụ dự án";

        if (!serviceId && !contractService?.name) {
            return {
                hasService: false,
                serviceId: null,
                serviceName: null,
                itemContractServiceId: null,
                itemServiceName: null,
                hasItemBudget: false,
                itemBudget: 0,
                itemSpent: 0,
                remainingItemBudget: 0,
                hasTotalServiceBudget: false,
                totalServiceBudget: 0,
                totalServiceSpent: 0,
                remainingTotalServiceBudget: 0
            };
        }

        const projectRepo = AppDataSource.getRepository(Projects);
        const project = await projectRepo.findOne({
            where: { id: projectId },
            relations: ["contract", "contract.services", "contract.services.service"]
        });

        const allProjectTasks = await this.taskRepo.find({
            where: { project: { id: projectId } },
            relations: [
                "contractService",
                "contractService.service",
                "opportunityServiceJob",
                "opportunityServiceJob.opportunityService",
                "opportunityServiceJob.opportunityService.service"
            ]
        });

        // --- TẦNG 1: Dòng hạng mục cụ thể mà task đang liên kết trực tiếp ---
        const itemBudget = Math.round(Number(contractService?.budget || 0));
        const hasItemBudget = itemBudget > 0;
        let itemSpent = 0;

        if (contractService?.id) {
            const itemTaskIds = allProjectTasks
                .filter((t) => t.contractService?.id === contractService.id)
                .map((t) => t.id);

            if (itemTaskIds.length > 0) {
                const qbItem = this.repo.createQueryBuilder("pr")
                    .where("pr.projectId = :projectId", { projectId })
                    .andWhere("pr.taskId IN (:...taskIds)", { taskIds: itemTaskIds })
                    .andWhere("pr.approvalStatus NOT IN (:...excluded)", {
                        excluded: [PaymentRequestApprovalStatus.REJECTED, PaymentRequestApprovalStatus.CANCELLED]
                    });
                if (excludeRequestId) {
                    qbItem.andWhere("pr.id != :excludeId", { excludeId: excludeRequestId });
                }

                const itemList = await qbItem.getMany();
                itemSpent = itemList.reduce((sum, item) => {
                    const effAmount = (item.type === PaymentRequestType.ADVANCE && item.settlementStatus === PaymentSettlementStatus.SETTLED && item.settledAmount != null)
                        ? Math.round(Number(item.settledAmount))
                        : Math.round(Number(item.amount || 0));
                    return sum + effAmount;
                }, 0);
            }
        }

        // --- TẦNG 2: Tổng nhóm dịch vụ này trong toàn dự án (gom các dòng cùng loại) ---
        let totalServiceBudget = 0;
        let hasTotalServiceBudget = false;

        if (project?.contract?.services) {
            const matchingServices = project.contract.services.filter((cs) => {
                const csServiceId = cs.serviceId || cs.service?.id;
                if (serviceId && csServiceId && csServiceId === serviceId) return true;
                if (!serviceId && contractService?.name && cs.name === contractService.name) return true;
                return false;
            });

            matchingServices.forEach((cs) => {
                const b = Math.round(Number(cs.budget || 0));
                if (b > 0) {
                    totalServiceBudget += b;
                    hasTotalServiceBudget = true;
                }
            });
        }

        const matchingGroupTaskIds = allProjectTasks.filter((t) => {
            const tServiceId = t.contractService?.serviceId ||
                t.contractService?.service?.id ||
                t.opportunityServiceJob?.opportunityService?.serviceId ||
                t.opportunityServiceJob?.opportunityService?.service?.id;

            if (serviceId && tServiceId === serviceId) return true;
            if (!serviceId && contractService?.name && t.contractService?.name === contractService.name) return true;
            return false;
        }).map((t) => t.id);

        let totalServiceSpent = 0;
        if (matchingGroupTaskIds.length > 0) {
            const qbGroup = this.repo.createQueryBuilder("pr")
                .where("pr.projectId = :projectId", { projectId })
                .andWhere("pr.taskId IN (:...taskIds)", { taskIds: matchingGroupTaskIds })
                .andWhere("pr.approvalStatus NOT IN (:...excluded)", {
                    excluded: [PaymentRequestApprovalStatus.REJECTED, PaymentRequestApprovalStatus.CANCELLED]
                });
            if (excludeRequestId) {
                qbGroup.andWhere("pr.id != :excludeId", { excludeId: excludeRequestId });
            }

            const groupList = await qbGroup.getMany();
            totalServiceSpent = groupList.reduce((sum, item) => {
                const effAmount = (item.type === PaymentRequestType.ADVANCE && item.settlementStatus === PaymentSettlementStatus.SETTLED && item.settledAmount != null)
                    ? Math.round(Number(item.settledAmount))
                    : Math.round(Number(item.amount || 0));
                return sum + effAmount;
            }, 0);
        }

        return {
            hasService: true,
            serviceId: serviceId || null,
            serviceName,
            // Tầng 1
            itemContractServiceId: contractService?.id || null,
            itemServiceName: contractService?.name || serviceName,
            hasItemBudget,
            itemBudget,
            itemSpent,
            remainingItemBudget: hasItemBudget ? (itemBudget - itemSpent) : 0,
            // Tầng 2
            hasTotalServiceBudget,
            totalServiceBudget,
            totalServiceSpent,
            remainingTotalServiceBudget: hasTotalServiceBudget ? (totalServiceBudget - totalServiceSpent) : 0
        };
    }

    /**
     * Lấy tổng hợp ngân sách, chi phí và tỷ lệ giải ngân của một dự án
     * Phục vụ Finance/Budget Widget và Bảng Thống kê dịch vụ trên trang Dự án
     */
    async getProjectBudgetSummary(projectId: string) {
        if (!projectId) {
            throw new Error("Vui lòng cung cấp mã dự án (projectId)");
        }

        const projectRepo = AppDataSource.getRepository(Projects);
        const project = await projectRepo.findOne({
            where: { id: projectId },
            relations: ["contract", "contract.services", "contract.services.service"]
        });

        if (!project) {
            throw new Error("Không tìm thấy dự án");
        }

        const allProjectTasks = await this.taskRepo.find({
            where: { project: { id: projectId } },
            relations: [
                "contractService",
                "contractService.service",
                "opportunityServiceJob",
                "opportunityServiceJob.opportunityService",
                "opportunityServiceJob.opportunityService.service"
            ]
        });

        const qb = this.repo.createQueryBuilder("pr")
            .where("pr.projectId = :projectId", { projectId })
            .andWhere("pr.approvalStatus NOT IN (:...excluded)", {
                excluded: [PaymentRequestApprovalStatus.REJECTED, PaymentRequestApprovalStatus.CANCELLED]
            });
        const paymentRequests = await qb.getMany();

        const getEffectiveAmount = (pr: PaymentRequests): number => {
            if (
                pr.type === PaymentRequestType.ADVANCE &&
                pr.settlementStatus === PaymentSettlementStatus.SETTLED &&
                pr.settledAmount != null
            ) {
                return Math.round(Number(pr.settledAmount));
            }
            return Math.round(Number(pr.amount || 0));
        };

        // 1. Tổng thực chi toàn dự án
        const totalProjectSpent = paymentRequests.reduce((sum, pr) => sum + getEffectiveAmount(pr), 0);

        // 2. Tổng ngân sách theo hợp đồng
        let totalProjectBudget = 0;
        if (project.contract?.services && Array.isArray(project.contract.services)) {
            totalProjectBudget = project.contract.services.reduce(
                (sum, cs) => sum + Math.round(Number(cs.budget || 0)),
                0
            );
        }
        if (totalProjectBudget === 0 && (project.contract as any)?.totalAmount) {
            totalProjectBudget = Math.round(Number((project.contract as any).totalAmount || 0));
        }

        const remainingProjectBudget = totalProjectBudget - totalProjectSpent;
        const disbursementPercentage = totalProjectBudget > 0
            ? Math.round((totalProjectSpent / totalProjectBudget) * 1000) / 10
            : 0;

        // 3. Chi tiết cho từng dịch vụ hợp đồng
        const serviceBudgets = (project.contract?.services || []).map((cs) => {
            const budget = Math.round(Number(cs.budget || 0));
            const csId = cs.id;
            const csServiceId = cs.serviceId || cs.service?.id;

            const relatedTaskIds = allProjectTasks
                .filter((t) => {
                    if (t.contractService?.id && csId && t.contractService.id === csId) return true;
                    const tServiceId = t.contractService?.serviceId ||
                        t.contractService?.service?.id ||
                        t.opportunityServiceJob?.opportunityService?.serviceId ||
                        t.opportunityServiceJob?.opportunityService?.service?.id;
                    if (csServiceId && tServiceId && csServiceId === tServiceId) return true;
                    if (!csServiceId && cs.name && t.contractService?.name === cs.name) return true;
                    return false;
                })
                .map((t) => t.id);

            const spent = paymentRequests
                .filter((pr) => pr.taskId && relatedTaskIds.includes(pr.taskId))
                .reduce((sum, pr) => sum + getEffectiveAmount(pr), 0);

            const remaining = budget - spent;

            return {
                contractServiceId: cs.id,
                serviceId: csServiceId || null,
                serviceName: cs.name || cs.service?.name || `Dịch vụ #${cs.id}`,
                budget,
                spent,
                remaining,
                status: cs.status
            };
        });

        return {
            projectId: project.id,
            projectName: project.name,
            totalProjectBudget,
            totalProjectSpent,
            remainingProjectBudget,
            disbursementPercentage,
            serviceBudgets
        };
    }

    private async validateBudgetReason(
        type: PaymentRequestType,
        projectId: string | null | undefined,
        taskId: string | null | undefined,
        amount: number,
        overBudgetReason: string | null | undefined,
        excludeRequestId?: string
    ): Promise<string | null> {
        if ([PaymentRequestType.PROJECT, PaymentRequestType.ADVANCE].includes(type) && projectId && taskId) {
            const budgetInfo = await this.getServiceBudgetInfo(projectId, taskId, excludeRequestId);
            if (budgetInfo.hasTotalServiceBudget) {
                const isOver = Math.round(Number(amount)) > Math.round(Number(budgetInfo.remainingTotalServiceBudget)) || budgetInfo.remainingTotalServiceBudget <= 0;
                if (isOver) {
                    if (!overBudgetReason || !overBudgetReason.trim()) {
                        throw new Error("Yêu cầu thanh toán vượt ngân sách dịch vụ dự án. Vui lòng nhập lý do giải trình.");
                    }
                    return overBudgetReason.trim();
                }
            }
            if (overBudgetReason && overBudgetReason.trim()) {
                return overBudgetReason.trim();
            }
        }
        return overBudgetReason?.trim() || null;
    }

    async create(dto: any, requesterId: string) {
        if (!dto.type || !Object.values(PaymentRequestType).includes(dto.type)) {
            throw new Error("Loại thanh toán không hợp lệ");
        }

        if (!dto.content || !dto.content.trim()) {
            throw new Error("Vui lòng nhập nội dung yêu cầu thanh toán");
        }

        if (!dto.amount || Number(dto.amount) <= 0) {
            throw new Error("Vui lòng nhập số tiền thanh toán hợp lệ lớn hơn 0");
        }

        if (!dto.dueDate) {
            throw new Error("Vui lòng chọn thời hạn thanh toán");
        }

        const invoiceImages = dto.invoiceImages || [];
        const rawInvoicePdfs = dto.invoicePdfs || [];

        let projectName = "";
        if (dto.projectId) {
            try {
                const proj = await AppDataSource.getRepository(Projects).findOne({ where: { id: dto.projectId } });
                projectName = proj?.name || "";
            } catch (pErr: any) {
                console.warn("[create] Không tìm thấy tên dự án:", pErr?.message);
            }
        }

        const invoicePdfs = await this.processGeneratedDocs(rawInvoicePdfs, { projectId: dto.projectId, projectName });

        const request = new PaymentRequests();
        request.type = dto.type;
        request.content = dto.content.trim();
        request.amount = dto.amount;
        request.dueDate = dto.dueDate;
        request.projectId = dto.projectId || null;
        request.taskId = dto.taskId || null;
        request.isUrgent = Boolean(dto.isUrgent);
        request.expenseCategory = dto.expenseCategory || null;
        request.invoiceImages = invoiceImages;
        request.invoicePdfs = invoicePdfs;
        request.requesterId = requesterId;
        request.approvalStatus = PaymentRequestApprovalStatus.PENDING_REVIEWER;
        request.paymentStatus = PaymentDueStatus.WAITING;

        if (dto.type === PaymentRequestType.PROJECT || (dto.type === PaymentRequestType.ADVANCE && dto.projectId)) {
            if (!dto.projectId) {
                throw new Error("Vui lòng chọn dự án");
            }
            if (!dto.taskId) {
                throw new Error("Vui lòng chọn công việc thuộc dự án");
            }
            const task = await this.taskRepo.findOne({
                where: { id: dto.taskId },
                relations: [
                    "project",
                    "assignee",
                    "contractService",
                    "contractService.service",
                    "opportunityServiceJob",
                    "opportunityServiceJob.opportunityService",
                    "opportunityServiceJob.opportunityService.service",
                    "mappedService"
                ]
            });
            if (!task) {
                throw new Error("Không tìm thấy công việc");
            }
            if (!task.project || task.project.id !== dto.projectId) {
                throw new Error("Công việc không thuộc dự án đã chọn");
            }
            if (!task.assigneeId || task.assigneeId !== requesterId) {
                throw new Error("Công việc này không được giao cho bạn");
            }

            const hasServiceRelation = Boolean(task.contractService || task.mappedService || task.opportunityServiceJob);
            const isBudgetEnabled = (
                task.contractService?.service?.isBudget === true ||
                (task.contractService as any)?.isBudget === true ||
                task.opportunityServiceJob?.opportunityService?.service?.isBudget === true ||
                task.mappedService?.isBudget === true
            );
            if (hasServiceRelation && !isBudgetEnabled) {
                throw new Error("Công việc đã chọn không thuộc dịch vụ có quản lý ngân sách (isBudget = true)");
            }
            request.costPrice = task.cost;
        } else if (dto.type === PaymentRequestType.OTHER_WORK && dto.taskId) {
            const task = await this.taskRepo.findOne({ where: { id: dto.taskId }, relations: ["project", "assignee"] });
            if (!task) {
                throw new Error("Không tìm thấy công việc");
            }
            if (task.project) {
                throw new Error("Công việc đã chọn thuộc dự án, không phải công việc khác");
            }
            if (!task.assigneeId || task.assigneeId !== requesterId) {
                throw new Error("Công việc này không được giao cho bạn");
            }
            request.costPrice = task.cost;
        }

        if (dto.type === PaymentRequestType.ADVANCE) {
            request.settlementStatus = PaymentSettlementStatus.PENDING;
            request.settlementDueDate = dto.settlementDueDate ? new Date(dto.settlementDueDate) : null;
        }

        request.overBudgetReason = await this.validateBudgetReason(
            dto.type,
            dto.projectId,
            dto.taskId,
            Number(dto.amount),
            dto.overBudgetReason
        );

        this.pushHistory(request, {
            action: "CREATED",
            byId: requesterId,
            snapshot: {
                content: request.content,
                amount: request.amount,
                dueDate: request.dueDate,
                invoiceImages: request.invoiceImages,
                invoicePdfs: request.invoicePdfs,
                settlementDueDate: request.settlementDueDate,
                overBudgetReason: request.overBudgetReason
            }
        });

        const saved = await this.repo.save(request);

        // Chỉ tự động đồng bộ lên Google Sheet khi ĐÃ CÓ giấy đề nghị thanh toán (Word)
        const hasPaymentDoc = (saved.invoicePdfs || []).some(
            (p: any) => p.docType === "PAYMENT_REQUEST_DOC" && p.url
        );
        if (hasPaymentDoc) {
            try {
                await this.syncToGoogleSheet(saved.id);
            } catch (sheetErr: any) {
                console.error("[create] Lỗi tự động đồng bộ Google Sheet:", sheetErr?.message);
            }
        }

        // Thông báo cho các bên liên quan (Admin Sale/Admin) để duyệt vòng 1
        await this.notifyRoles(REVIEWER_NOTIFY_ROLES, {
            title: "Yêu cầu thanh toán mới",
            content: `Có yêu cầu thanh toán mới cần duyệt: ${saved.content} (${Number(saved.amount).toLocaleString("vi-VN")}đ)`,
            type: "PAYMENT_REQUEST_CREATED",
            relatedEntityId: saved.id,
            link: `/payment-requests/${saved.id}`,
            excludeUserId: requesterId
        });

        return saved;
    }

    /**
     * Cách khởi tạo riêng của yêu cầu "thuê vendor": tự động tạo khi một task được phân công cho vendor.
     * Đây vẫn là yêu cầu thanh toán loại PROJECT (gắn dự án + công việc), chỉ khác ở chỗ có vendorId và
     * isAutoGenerated = true. Thông tin được điền sẵn theo dự án/công việc/vendor; requester là người
     * thực hiện phân công (PM/Admin) vì vendor không phải tài khoản trong hệ thống. Yêu cầu tạo ở trạng
     * thái DRAFT để người phụ trách xem lại, bổ sung nội dung/hoá đơn trước khi gửi duyệt chính thức.
     */
    async createVendorExpense(data: {
        projectId: string;
        taskId: string;
        vendorId: string;
        vendorName: string;
        taskName: string;
        taskCode?: string | null;
        projectName?: string;
        amount: number;
        dueDate: Date;
        requesterId: string;
    }, manager?: EntityManager) {
        const repo = manager ? manager.getRepository(PaymentRequests) : this.repo;

        const request = repo.create({
            type: PaymentRequestType.PROJECT,
            content: `Chi phí phát sinh - Vendor ${data.vendorName} thực hiện công việc "${data.taskName}"${data.taskCode ? ` (Mã: ${data.taskCode})` : ""}${data.projectName ? ` - Dự án ${data.projectName}` : ""}`,
            amount: data.amount,
            costPrice: data.amount,
            dueDate: data.dueDate,
            projectId: data.projectId,
            taskId: data.taskId,
            vendorId: data.vendorId,
            isAutoGenerated: true,
            requesterId: data.requesterId,
            approvalStatus: PaymentRequestApprovalStatus.DRAFT,
            paymentStatus: PaymentDueStatus.WAITING,
            invoiceImages: [],
            invoicePdfs: []
        } as any) as unknown as PaymentRequests;

        this.pushHistory(request, {
            action: "CREATED",
            byId: data.requesterId,
            note: "Tự động tạo khi phân công công việc cho vendor",
            snapshot: {
                content: request.content,
                amount: request.amount,
                dueDate: request.dueDate,
                invoiceImages: [],
                invoicePdfs: []
            }
        });

        const saved = await repo.save(request);

        await this.notifyUser(data.requesterId, {
            title: "Đã tạo yêu cầu thanh toán chi phí phát sinh (vendor)",
            content: `Task "${data.taskName}" vừa được giao cho vendor ${data.vendorName}. Hệ thống đã tạo sẵn 1 yêu cầu thanh toán nháp, vui lòng kiểm tra và gửi duyệt.`,
            type: "PAYMENT_REQUEST_VENDOR_AUTO_CREATED",
            relatedEntityId: saved.id,
            link: `/payment-requests/${saved.id}`
        }, manager);

        return saved;
    }

    async getAll(query: PaymentRequestQuery, viewer?: PaymentRequestViewer) {
        const qb = this.repo.createQueryBuilder("pr")
            .leftJoinAndSelect("pr.project", "project")
            .leftJoinAndSelect("pr.task", "task")
            .leftJoinAndSelect("pr.vendor", "vendor")
            .leftJoinAndSelect("pr.requester", "requester")
            .leftJoinAndSelect("pr.reviewer", "reviewer")
            .leftJoinAndSelect("pr.bodDecisionBy", "bodDecisionBy");

        if (query.search) {
            qb.andWhere("pr.content ILIKE :search", { search: `%${query.search}%` });
        }
        if (query.type === ("DIRECT_PAYMENT" as any)) {
            qb.andWhere("pr.type != :advanceType", { advanceType: PaymentRequestType.ADVANCE });
        } else if (isValidRequestType(query.type)) {
            qb.andWhere("pr.type = :type", { type: query.type });
        }
        if (query.approvalStatus) {
            qb.andWhere("pr.approvalStatus = :approvalStatus", { approvalStatus: query.approvalStatus });
        }
        if (query.settlementStatus) {
            qb.andWhere("pr.settlementStatus = :settlementStatus", { settlementStatus: query.settlementStatus });
        }
        if (query.projectId) {
            qb.andWhere("pr.projectId = :projectId", { projectId: query.projectId });
        }

        const dateCol = query.dateField === "createdAt" ? "pr.createdAt" : "COALESCE(pr.confirmedDueDate, pr.dueDate)";
        if (query.fromDate) {
            qb.andWhere(`${dateCol} >= :fromDate`, { fromDate: new Date(`${query.fromDate}T00:00:00.000`) });
        }
        if (query.toDate) {
            qb.andWhere(`${dateCol} <= :toDate`, { toDate: new Date(`${query.toDate}T23:59:59.999`) });
        }

        if (query.minAmount !== undefined && query.minAmount !== "" && !isNaN(Number(query.minAmount))) {
            qb.andWhere("pr.amount >= :minAmount", { minAmount: Number(query.minAmount) });
        }
        if (query.maxAmount !== undefined && query.maxAmount !== "" && !isNaN(Number(query.maxAmount))) {
            qb.andWhere("pr.amount <= :maxAmount", { maxAmount: Number(query.maxAmount) });
        }

        // Phân quyền hiển thị: chỉ Admin Sale/BOD/Admin thấy toàn bộ, còn lại chỉ thấy yêu cầu do
        // chính mình tạo (bao gồm cả chi phí phát sinh vendor vì requesterId là người phân công).
        if (viewer && !FULL_VISIBILITY_ROLES.includes(viewer.role as UserRole)) {
            qb.andWhere("pr.requesterId = :viewerId", { viewerId: viewer.userId });
        }

        const sortColumn = query.sortBy === "amount" ? "pr.amount" : query.sortBy === "dueDate" ? "pr.dueDate" : "pr.createdAt";
        const sortOrder = query.sortOrder === "ASC" ? "ASC" : "DESC";
        qb.orderBy(sortColumn, sortOrder);

        const results = await qb.getMany();

        const withComputedStatus = results.map((request) => {
            request.paymentStatus = computePaymentStatus(request);
            request.settlementStatus = computeSettlementStatus(request);
            (request as any).isOverdue = computeIsOverdue(request);
            return request;
        });

        if (query.paymentStatus) {
            return withComputedStatus.filter((request) => request.paymentStatus === query.paymentStatus);
        }

        return withComputedStatus;
    }

    async getOne(id: string, viewer?: PaymentRequestViewer) {
        const request = await this.repo.findOne({ where: { id }, relations: this.relations });
        if (!request) throw new Error("Không tìm thấy yêu cầu thanh toán");
        if (!canViewRequest(request, viewer)) {
            throw new Error("Bạn không có quyền xem yêu cầu thanh toán này");
        }
        request.paymentStatus = computePaymentStatus(request);
        request.settlementStatus = computeSettlementStatus(request);
        (request as any).isOverdue = computeIsOverdue(request);
        return request;
    }

    async update(id: string, dto: any) {
        const request = await this.getOne(id);

        if (dto.cashVoucherInfo !== undefined || dto.paymentMethod !== undefined) {
            if (dto.cashVoucherInfo !== undefined) request.cashVoucherInfo = dto.cashVoucherInfo;
            if (dto.paymentMethod !== undefined) request.paymentMethod = dto.paymentMethod;
            if (Object.keys(dto).every((k) => ["cashVoucherInfo", "paymentMethod"].includes(k))) {
                return await this.repo.save(request);
            }
        }

        if (request.approvalStatus === PaymentRequestApprovalStatus.NEED_MORE_DOCS) {
            throw new Error("Yêu cầu này đang cần bổ sung, vui lòng dùng chức năng bổ sung để giữ lại lịch sử");
        }

        if (request.approvalStatus !== PaymentRequestApprovalStatus.DRAFT) {
            throw new Error("Yêu cầu thanh toán đã được xử lý, không thể sửa nội dung");
        }

        // Chặn sửa amount thấp hơn paidAmount nếu phiếu đã có giải ngân
        if (dto.amount !== undefined) {
            const newAmount = Math.round(Number(dto.amount));
            if (newAmount <= 0) {
                throw new Error("Số tiền thanh toán phải lớn hơn 0");
            }
            const currentPaid = Math.round(Number(request.paidAmount || 0));
            if (currentPaid > 0 && newAmount < currentPaid) {
                throw new Error(`Không thể giảm số tiền yêu cầu thanh toán (${newAmount.toLocaleString("vi-VN")}đ) thấp hơn số tiền đã chi (${currentPaid.toLocaleString("vi-VN")}đ)`);
            }
        }

        // Yêu cầu thuê vendor (hệ thống tự tạo khi giao task cho vendor) gắn cố định với dự án/công việc/vendor:
        // chỉ cho sửa nội dung, số tiền, hạn, hoá đơn — không cho đổi loại, dự án hay công việc.
        const isVendorLinked = Boolean(request.vendorId);

        const editableFields = isVendorLinked
            ? ["content", "amount", "dueDate", "invoiceImages"]
            : ["content", "amount", "dueDate", "projectId", "taskId", "invoiceImages", "settlementDueDate"];
        for (const field of editableFields) {
            if (dto[field] !== undefined) {
                (request as any)[field] = dto[field];
            }
        }

        if (dto.invoicePdfs !== undefined) {
            let projectName = "";
            const pid = dto.projectId !== undefined ? dto.projectId : request.projectId;
            if (pid) {
                try {
                    const proj = await AppDataSource.getRepository(Projects).findOne({ where: { id: pid } });
                    projectName = proj?.name || "";
                } catch (pErr: any) {
                    console.warn("[update] Không tìm thấy tên dự án:", pErr?.message);
                }
            }
            request.invoicePdfs = await this.processGeneratedDocs(dto.invoicePdfs, { projectId: pid, projectName });
        }

        if (dto.settlementDueDate !== undefined) {
            request.settlementDueDate = dto.settlementDueDate ? new Date(dto.settlementDueDate) : null;
        }

        if (dto.type !== undefined && !isVendorLinked) {
            if (!Object.values(PaymentRequestType).includes(dto.type)) {
                throw new Error("Loại thanh toán không hợp lệ");
            }
            request.type = dto.type;
        }

        if (request.type === PaymentRequestType.PROJECT || (request.type === PaymentRequestType.ADVANCE && request.projectId)) {
            if (!request.taskId) {
                throw new Error("Vui lòng chọn công việc thuộc dự án");
            }
            const task = await this.taskRepo.findOne({
                where: { id: request.taskId },
                relations: [
                    "project",
                    "vendor",
                    "contractService",
                    "contractService.service",
                    "opportunityServiceJob",
                    "opportunityServiceJob.opportunityService",
                    "opportunityServiceJob.opportunityService.service",
                    "mappedService"
                ]
            });
            if (!task) {
                throw new Error("Không tìm thấy công việc");
            }
            if (!task.project || task.project.id !== request.projectId) {
                throw new Error("Công việc không thuộc dự án đã chọn");
            }
            if (isVendorLinked) {
                // Người tạo là người phân công (không phải assignee) nên kiểm tra task vẫn đang giao đúng vendor này.
                if (task.vendor?.id !== request.vendorId) {
                    throw new Error("Công việc không còn được giao cho vendor này");
                }
            } else if (!task.assigneeId || task.assigneeId !== request.requesterId) {
                throw new Error("Công việc này không được giao cho bạn");
            }

            const hasServiceRelation = Boolean(task.contractService || task.mappedService || task.opportunityServiceJob);
            const isBudgetEnabled = (
                task.contractService?.service?.isBudget === true ||
                (task.contractService as any)?.isBudget === true ||
                task.opportunityServiceJob?.opportunityService?.service?.isBudget === true ||
                task.mappedService?.isBudget === true
            );
            if (hasServiceRelation && !isBudgetEnabled) {
                throw new Error("Chỉ được tạo yêu cầu thanh toán cho công việc thuộc dịch vụ có quản lý ngân sách (isBudget = true)");
            }
            request.costPrice = task.cost;
        } else if (request.type === PaymentRequestType.OTHER_WORK && request.taskId) {
            const task = await this.taskRepo.findOne({ where: { id: request.taskId }, relations: ["project"] });
            if (!task) {
                throw new Error("Không tìm thấy công việc");
            }
            if (task.project) {
                throw new Error("Công việc đã chọn thuộc dự án, không phải công việc khác");
            }
            if (!task.assigneeId || task.assigneeId !== request.requesterId) {
                throw new Error("Công việc này không được giao cho bạn");
            }
            request.costPrice = task.cost;
        }

        const effectiveType = dto.type || request.type;
        const effectiveProjectId = dto.projectId !== undefined ? dto.projectId : request.projectId;
        const effectiveTaskId = dto.taskId !== undefined ? dto.taskId : request.taskId;
        const effectiveAmount = dto.amount !== undefined ? Number(dto.amount) : Number(request.amount);
        const effectiveReason = dto.overBudgetReason !== undefined ? dto.overBudgetReason : request.overBudgetReason;

        request.overBudgetReason = await this.validateBudgetReason(
            effectiveType,
            effectiveProjectId,
            effectiveTaskId,
            effectiveAmount,
            effectiveReason,
            id
        );

        return await this.repo.save(request);
    }

    /**
     * Gửi duyệt một yêu cầu đang ở trạng thái nháp (DRAFT) — áp dụng cho yêu cầu tự tạo thủ công
     * hoặc yêu cầu "chi phí phát sinh" mà hệ thống tự tạo khi phân công task cho vendor.
     */
    async submit(id: string, requesterId: string) {
        const request = await this.getOne(id);

        if (request.approvalStatus !== PaymentRequestApprovalStatus.DRAFT) {
            throw new Error("Chỉ có thể gửi duyệt yêu cầu đang ở trạng thái nháp");
        }
        if (request.requesterId !== requesterId) {
            throw new Error("Bạn không phải người tạo yêu cầu này");
        }

        request.approvalStatus = PaymentRequestApprovalStatus.PENDING_REVIEWER;
        this.pushHistory(request, { action: "SUBMITTED", byId: requesterId });
        const saved = await this.repo.save(request);

        await this.notifyRoles(REVIEWER_NOTIFY_ROLES, {
            title: "Yêu cầu thanh toán mới",
            content: `Có yêu cầu thanh toán mới cần duyệt: ${saved.content} (${Number(saved.amount).toLocaleString("vi-VN")}đ)`,
            type: "PAYMENT_REQUEST_CREATED",
            relatedEntityId: saved.id,
            link: `/payment-requests/${saved.id}`,
            excludeUserId: requesterId
        });

        return saved;
    }

    /**
     * Người tạo BỔ SUNG hồ sơ/nội dung khi yêu cầu đang ở trạng thái "Cần bổ sung" (NEED_MORE_DOCS).
     * Khác với update(): trạng thái TRƯỚC khi bổ sung (nội dung, số tiền, hạn, hoá đơn cũ) được lưu
     * lại vào `history` trước khi bị thay đổi, để không mất lịch sử các lần bổ sung.
     * File hoá đơn mới được CỘNG DỒN vào danh sách cũ thay vì ghi đè, trừ khi FE chủ động gửi danh sách đã gộp.
     */
    async supplement(id: string, dto: any, requesterId: string) {
        const request = await this.getOne(id);

        if (request.approvalStatus !== PaymentRequestApprovalStatus.NEED_MORE_DOCS) {
            throw new Error("Yêu cầu thanh toán không ở trạng thái cần bổ sung");
        }
        if (request.requesterId !== requesterId) {
            throw new Error("Bạn không phải người tạo yêu cầu này");
        }

        // Lưu lại trạng thái hiện tại vào lịch sử TRƯỚC khi ghi đè
        this.pushHistory(request, {
            action: "SUPPLEMENTED",
            byId: requesterId,
            note: dto.note || null,
            snapshot: {
                content: request.content,
                amount: request.amount,
                dueDate: request.dueDate,
                invoiceImages: request.invoiceImages,
                invoicePdfs: request.invoicePdfs
            }
        });

        if (dto.content !== undefined) request.content = dto.content;
        if (dto.amount !== undefined) request.amount = dto.amount;
        if (dto.dueDate !== undefined) request.dueDate = dto.dueDate;

        // Hoá đơn bổ sung: cộng dồn vào danh sách hiện có (không xoá hồ sơ cũ) trừ khi FE truyền cờ replace
        if (Array.isArray(dto.addInvoiceImages) && dto.addInvoiceImages.length) {
            request.invoiceImages = [...(request.invoiceImages || []), ...dto.addInvoiceImages];
        } else if (dto.invoiceImages !== undefined) {
            request.invoiceImages = dto.invoiceImages;
        }
        let supplementProjectName = request.project?.name || "";
        if (!supplementProjectName && request.projectId) {
            try {
                const proj = await AppDataSource.getRepository(Projects).findOne({ where: { id: request.projectId } });
                supplementProjectName = proj?.name || "";
            } catch (pErr: any) {
                console.warn("[supplement] Không tìm thấy tên dự án:", pErr?.message);
            }
        }

        if (Array.isArray(dto.addInvoicePdfs) && dto.addInvoicePdfs.length) {
            const processedAdd = await this.processGeneratedDocs(dto.addInvoicePdfs, { projectName: supplementProjectName });
            request.invoicePdfs = [...(request.invoicePdfs || []), ...processedAdd];
        } else if (dto.invoicePdfs !== undefined) {
            request.invoicePdfs = await this.processGeneratedDocs(dto.invoicePdfs, { projectName: supplementProjectName });
        }

        // Quay lại hàng chờ Admin Sale duyệt
        request.approvalStatus = PaymentRequestApprovalStatus.PENDING_REVIEWER;
        request.reviewNote = null;

        const saved = await this.repo.save(request);

        // Thông báo cho các bên duyệt là yêu cầu đã được bổ sung, cần xem lại
        await this.notifyRoles(REVIEWER_NOTIFY_ROLES, {
            title: "Yêu cầu thanh toán đã được bổ sung",
            content: `${saved.requester?.fullName || "Người tạo"} đã bổ sung hồ sơ cho yêu cầu: ${saved.content}. Vui lòng xem lại.`,
            type: "PAYMENT_REQUEST_SUPPLEMENTED",
            relatedEntityId: saved.id,
            link: `/payment-requests/${saved.id}`,
            excludeUserId: requesterId
        });

        // Nếu người duyệt vòng 1 trước đó đã yêu cầu bổ sung, báo riêng cho họ biết
        if (saved.reviewerId) {
            await this.notifyUser(saved.reviewerId, {
                title: "Yêu cầu thanh toán đã được bổ sung",
                content: `${saved.requester?.fullName || "Người tạo"} đã bổ sung hồ sơ cho yêu cầu: ${saved.content}. Vui lòng xem lại.`,
                type: "PAYMENT_REQUEST_SUPPLEMENTED",
                relatedEntityId: saved.id,
                link: `/payment-requests/${saved.id}`
            });
        }

        return saved;
    }

    async addInvoicePdf(id: string, file: PaymentRequestFile) {
        const request = await this.getOne(id);
        request.invoicePdfs = [...(request.invoicePdfs || []), { ...file, uploadedAt: new Date().toISOString() }];
        return await this.repo.save(request);
    }

    async review(id: string, action: "APPROVE" | "REJECT" | "REQUEST_MORE_DOCS", note: string, reviewerId: string, reviewerRole: string) {
        const request = await this.getOne(id);

        if (request.approvalStatus !== PaymentRequestApprovalStatus.PENDING_REVIEWER) {
            throw new Error("Yêu cầu thanh toán không ở trạng thái chờ duyệt");
        }

        const allowedRoles = REVIEWER_ROLES;
        if (!allowedRoles.includes(reviewerRole as UserRole) && ![UserRole.BOD, UserRole.ADMIN].includes(reviewerRole as UserRole)) {
            throw new Error("Bạn không có quyền duyệt yêu cầu thanh toán này");
        }

        if ((action === "REJECT" || action === "REQUEST_MORE_DOCS") && (!note || !note.trim())) {
            throw new Error("Vui lòng nhập lý do");
        }

        request.reviewerId = reviewerId;
        request.reviewedAt = new Date();
        request.reviewNote = note || null;

        if (action === "APPROVE") {
            request.approvalStatus = PaymentRequestApprovalStatus.PENDING_BOD;
            request.submittedToBodById = reviewerId;
            request.submittedToBodAt = new Date();
        } else if (action === "REJECT") {
            request.approvalStatus = PaymentRequestApprovalStatus.REJECTED;
            if (request.type === PaymentRequestType.ADVANCE) {
                request.settlementStatus = PaymentSettlementStatus.NOT_APPLICABLE;
            }
        } else if (action === "REQUEST_MORE_DOCS") {
            request.approvalStatus = PaymentRequestApprovalStatus.NEED_MORE_DOCS;
        } else {
            throw new Error("Hành động không hợp lệ");
        }

        this.pushHistory(request, { action: "REVIEWED", byId: reviewerId, note: note || null });
        const saved = await this.repo.save(request);

        if (action === "APPROVE") {
            await this.notifyUser(saved.requesterId, {
                title: "Yêu cầu thanh toán được duyệt vòng 1",
                content: `Yêu cầu thanh toán "${saved.content}" đã được duyệt và trình BOD xác nhận.`,
                type: "PAYMENT_REQUEST_APPROVED_REVIEWER",
                relatedEntityId: saved.id,
                link: `/payment-requests/${saved.id}`
            });
            await this.notifyRoles(BOD_NOTIFY_ROLES, {
                title: "Yêu cầu thanh toán chờ xác nhận",
                content: `Yêu cầu thanh toán "${saved.content}" (${Number(saved.amount).toLocaleString("vi-VN")}đ) đang chờ BOD xác nhận.`,
                type: "PAYMENT_REQUEST_PENDING_BOD",
                relatedEntityId: saved.id,
                link: `/payment-requests/${saved.id}`
            });
        } else if (action === "REJECT") {
            await this.notifyUser(saved.requesterId, {
                title: "Yêu cầu thanh toán bị từ chối",
                content: `Yêu cầu thanh toán "${saved.content}" đã bị từ chối${note ? `: ${note}` : "."}`,
                type: "PAYMENT_REQUEST_REJECTED",
                relatedEntityId: saved.id,
                link: `/payment-requests/${saved.id}`
            });
        } else if (action === "REQUEST_MORE_DOCS") {
            await this.notifyUser(saved.requesterId, {
                title: "Yêu cầu thanh toán cần bổ sung",
                content: `Yêu cầu thanh toán "${saved.content}" cần bổ sung hồ sơ${note ? `: ${note}` : "."}`,
                type: "PAYMENT_REQUEST_NEED_MORE_DOCS",
                relatedEntityId: saved.id,
                link: `/payment-requests/${saved.id}`
            });
        }

        return saved;
    }

    async bodDecision(id: string, action: "APPROVE" | "REJECT" | "REQUEST_MORE_DOCS", reason: string, bodUserId: string, confirmedDueDate?: string) {
        const request = await this.getOne(id);

        if (request.approvalStatus !== PaymentRequestApprovalStatus.PENDING_BOD) {
            throw new Error("Yêu cầu thanh toán không ở trạng thái chờ BOD xác nhận");
        }

        request.bodDecisionById = bodUserId;
        request.bodDecisionAt = new Date();
        request.bodDecisionReason = reason || null;

        if (action === "APPROVE") {
            request.approvalStatus = PaymentRequestApprovalStatus.APPROVED;
            if (confirmedDueDate) {
                request.confirmedDueDate = new Date(confirmedDueDate) as any;
                request.confirmedDueDateById = bodUserId;
            }
            if (request.taskId) {
                const task = await this.taskRepo.findOne({ where: { id: request.taskId } });
                if (task) {
                    task.spentAmount = Number(task.spentAmount || 0) + Number(request.amount);
                    await this.taskRepo.save(task);
                }
            }
        } else if (action === "REJECT") {
            if (!reason || !reason.trim()) {
                throw new Error("Vui lòng nhập lý do từ chối");
            }
            request.approvalStatus = PaymentRequestApprovalStatus.REJECTED;
            if (request.type === PaymentRequestType.ADVANCE) {
                request.settlementStatus = PaymentSettlementStatus.NOT_APPLICABLE;
            }
        } else if (action === "REQUEST_MORE_DOCS") {
            if (!reason || !reason.trim()) {
                throw new Error("Vui lòng nhập lý do yêu cầu bổ sung");
            }
            request.approvalStatus = PaymentRequestApprovalStatus.NEED_MORE_DOCS;
        } else {
            throw new Error("Hành động không hợp lệ");
        }

        request.paymentStatus = computePaymentStatus(request);
        this.pushHistory(request, { action: "BOD_DECISION", byId: bodUserId, note: reason || null });
        const saved = await this.repo.save(request);

        if (action === "APPROVE") {
            await this.notifyUser(saved.requesterId, {
                title: "Yêu cầu thanh toán đã được BOD xác nhận",
                content: `Yêu cầu thanh toán "${saved.content}" đã được BOD xác nhận, chờ chi tiền.`,
                type: "PAYMENT_REQUEST_APPROVED",
                relatedEntityId: saved.id,
                link: `/payment-requests/${saved.id}`
            });
            await this.notifyRoles([UserRole.ADMIN_SALE, UserRole.ADMIN], {
                title: "Yêu cầu thanh toán cần chi tiền",
                content: `Yêu cầu thanh toán "${saved.content}" (${Number(saved.amount).toLocaleString("vi-VN")}đ) đã được BOD duyệt, cần thực hiện chi tiền.`,
                type: "PAYMENT_REQUEST_READY_TO_PAY",
                relatedEntityId: saved.id,
                link: `/payment-requests/${saved.id}`
            });
        } else if (action === "REJECT") {
            await this.notifyUser(saved.requesterId, {
                title: "Yêu cầu thanh toán bị BOD từ chối",
                content: `Yêu cầu thanh toán "${saved.content}" đã bị BOD từ chối${reason ? `: ${reason}` : "."}`,
                type: "PAYMENT_REQUEST_REJECTED",
                relatedEntityId: saved.id,
                link: `/payment-requests/${saved.id}`
            });
        } else if (action === "REQUEST_MORE_DOCS") {
            await this.notifyUser(saved.requesterId, {
                title: "Yêu cầu thanh toán cần bổ sung",
                content: `Yêu cầu thanh toán "${saved.content}" bị BOD yêu cầu bổ sung hồ sơ${reason ? `: ${reason}` : "."}`,
                type: "PAYMENT_REQUEST_NEED_MORE_DOCS",
                relatedEntityId: saved.id,
                link: `/payment-requests/${saved.id}`
            });
        }

        return saved;
    }

    async recordPayment(
        id: string,
        dto: RecordPaymentDTO,
        payerId: string,
        payerRole: string,
        payerName?: string
    ) {
        if (!ACCOUNTANT_ROLES.includes(payerRole as UserRole)) {
            throw new Error("Bạn không có quyền thực hiện chi tiền thanh toán");
        }

        return await AppDataSource.transaction(async (manager) => {
            const request = await manager.getRepository(PaymentRequests)
                .createQueryBuilder("pr")
                .setLock("pessimistic_write")
                .where("pr.id = :id", { id })
                .getOne();

            if (!request) throw new Error("Không tìm thấy yêu cầu thanh toán");

            if (request.approvalStatus !== PaymentRequestApprovalStatus.APPROVED) {
                throw new Error("Yêu cầu thanh toán chưa được phê duyệt, không thể chi tiền");
            }

            const totalRequired = Math.round(Number(request.amount));
            const currentPaid = Math.round(Number(request.paidAmount || 0));
            const remainingToPay = totalRequired - currentPaid;

            if (remainingToPay <= 0) {
                throw new Error("Yêu cầu này đã được thanh toán đủ toàn bộ số tiền");
            }

            let payThisTime: number;
            if (dto.paidAmountThisTime !== undefined) {
                payThisTime = Math.round(Number(dto.paidAmountThisTime));
                if (payThisTime <= 0) {
                    throw new Error("Số tiền chi đợt này phải lớn hơn 0");
                }
                if (payThisTime > remainingToPay) {
                    throw new Error(`Số tiền chi đợt này (${payThisTime.toLocaleString("vi-VN")}đ) không được vượt quá số tiền còn lại (${remainingToPay.toLocaleString("vi-VN")}đ)`);
                }
            } else {
                payThisTime = remainingToPay;
            }

            const proofFiles = Array.isArray(dto.paymentProofs) && dto.paymentProofs.length > 0
                ? dto.paymentProofs.map((f) => ({ ...f, uploadedAt: f.uploadedAt || new Date().toISOString() }))
                : [];

            if (proofFiles.length === 0) {
                throw new Error("Vui lòng tải lên ảnh/PDF minh chứng đã chi tiền");
            }

            const newPaidAmount = currentPaid + payThisTime;
            const txn: PaymentTransactionRecord = {
                id: crypto.randomUUID(),
                amount: payThisTime,
                paidAt: new Date().toISOString(),
                payerId,
                payerName,
                paymentMethod: (dto.paymentMethod as string) || "BANK_TRANSFER",
                cashVoucherInfo: dto.cashVoucherInfo,
                proofFiles,
                note: dto.note
            };

            request.paidAmount = newPaidAmount;
            request.paymentTransactions = [...(request.paymentTransactions || []), txn];
            request.paymentProofs = [...(request.paymentProofs || []), ...proofFiles];
            if (dto.paymentMethod) request.paymentMethod = dto.paymentMethod as PaymentMethod;
            if (dto.cashVoucherInfo) request.cashVoucherInfo = dto.cashVoucherInfo;

            if (newPaidAmount >= totalRequired) {
                request.paymentStatus = PaymentDueStatus.PAID;
                request.paidAt = new Date();
                if (request.type === PaymentRequestType.ADVANCE) {
                    request.settlementStatus = PaymentSettlementStatus.WAITING_SETTLEMENT;
                }
            } else {
                request.paymentStatus = PaymentDueStatus.PARTIALLY_PAID;
            }

            this.pushHistory(request, {
                action: "PAID_INSTALLMENT",
                byId: payerId,
                note: `Chi đợt: ${payThisTime.toLocaleString("vi-VN")}đ (Lũy kế: ${newPaidAmount.toLocaleString("vi-VN")}/${totalRequired.toLocaleString("vi-VN")}đ)`
            });

            const saved = await manager.getRepository(PaymentRequests).save(request);

            if (newPaidAmount >= totalRequired) {
                await this.notifyUser(saved.requesterId, {
                    title: "Yêu cầu thanh toán đã được chi đủ",
                    content: `Yêu cầu thanh toán "${saved.content}" đã được chi đủ toàn bộ số tiền (${newPaidAmount.toLocaleString("vi-VN")}đ).`,
                    type: "PAYMENT_REQUEST_PAID",
                    relatedEntityId: saved.id,
                    link: `/payment-requests/${saved.id}`
                }, manager);
            } else {
                await this.notifyUser(saved.requesterId, {
                    title: "Yêu cầu thanh toán đã được chi một phần",
                    content: `Yêu cầu thanh toán "${saved.content}" vừa được chi thêm ${payThisTime.toLocaleString("vi-VN")}đ (Đã nhận: ${newPaidAmount.toLocaleString("vi-VN")}/${totalRequired.toLocaleString("vi-VN")}đ).`,
                    type: "PAYMENT_REQUEST_PAID_PARTIAL",
                    relatedEntityId: saved.id,
                    link: `/payment-requests/${saved.id}`
                }, manager);
            }

            return saved;
        });
    }

    async submitSettlement(id: string, dto: SubmitSettlementDTO, requesterId: string) {
        return await AppDataSource.transaction(async (manager) => {
            const request = await manager.getRepository(PaymentRequests)
                .createQueryBuilder("pr")
                .setLock("pessimistic_write")
                .where("pr.id = :id", { id })
                .getOne();

            if (!request) throw new Error("Không tìm thấy yêu cầu thanh toán");
            if (request.type !== PaymentRequestType.ADVANCE) {
                throw new Error("Chỉ áp dụng quyết toán cho yêu cầu Tạm ứng");
            }
            if (request.requesterId !== requesterId) {
                throw new Error("Chỉ người tạo phiếu tạm ứng mới có quyền nộp quyết toán");
            }
            if (Math.round(Number(request.paidAmount || 0)) < Math.round(Number(request.amount))) {
                throw new Error("Phiếu tạm ứng chưa được chi đủ toàn bộ số tiền, không thể nộp quyết toán");
            }
            if (request.settlementStatus !== PaymentSettlementStatus.WAITING_SETTLEMENT) {
                throw new Error("Phiếu không ở trạng thái chờ nộp quyết toán (WAITING_SETTLEMENT)");
            }

            const settledAmount = Math.round(Number(dto.settledAmount));
            if (isNaN(settledAmount) || settledAmount < 0) {
                throw new Error("Tổng tiền thực chi không hợp lệ và không được âm");
            }

            const paidAmount = Math.round(Number(request.paidAmount || 0));
            const diff = settledAmount - paidAmount;

            const files = Array.isArray(dto.settlementFiles) ? dto.settlementFiles : [];
            if (files.length === 0) {
                throw new Error("Bắt buộc phải tải lên chứng từ/minh chứng quyết toán hoàn ứng");
            }

            const expenseDocs = files.filter((f) => f.docType !== "REFUND_PROOF");
            const refundProofs = files.filter((f) => f.docType === "REFUND_PROOF");

            if (settledAmount > 0 && expenseDocs.length === 0) {
                throw new Error("Khoản thực chi phát sinh cần ít nhất 1 chứng từ chi phí thực tế (Biên bản nghiệm thu, Hóa đơn hoặc Hợp đồng)");
            }

            if (diff < 0 && refundProofs.length === 0) {
                throw new Error("Thừa tiền tạm ứng bắt buộc phải đính kèm minh chứng hoàn ứng (Bill nộp lại tiền thừa về quỹ)");
            }

            if (settledAmount === 0 && refundProofs.length === 0) {
                throw new Error("Không phát sinh thực chi bắt buộc phải đính kèm minh chứng hoàn trả 100% tiền tạm ứng về quỹ");
            }

            request.settledAmount = settledAmount;
            request.settlementDifference = diff;
            request.settlementFiles = files.map((f) => ({ ...f, uploadedAt: f.uploadedAt || new Date().toISOString() }));
            request.settlementNote = dto.settlementNote || null;
            request.settlementStatus = PaymentSettlementStatus.SETTLEMENT_SUBMITTED;

            this.pushHistory(request, {
                action: "SUBMIT_SETTLEMENT",
                byId: requesterId,
                note: `Nộp hồ sơ quyết toán: Thực chi ${settledAmount.toLocaleString("vi-VN")}đ (Chênh lệch: ${request.settlementDifference.toLocaleString("vi-VN")}đ)`
            });

            const saved = await manager.getRepository(PaymentRequests).save(request);

            await this.notifyRoles(ACCOUNTANT_ROLES, {
                title: "Hồ sơ quyết toán tạm ứng mới",
                content: `Nhân sự đã nộp quyết toán cho phiếu tạm ứng: ${saved.content} (Thực chi: ${settledAmount.toLocaleString("vi-VN")}đ, Chênh lệch: ${request.settlementDifference.toLocaleString("vi-VN")}đ)`,
                type: "PAYMENT_REQUEST_SETTLEMENT_SUBMITTED",
                relatedEntityId: saved.id,
                link: `/payment-requests/${saved.id}`,
                excludeUserId: requesterId
            }, manager);

            return saved;
        });
    }

    async approveSettlement(
        id: string,
        reviewerId: string,
        reviewerRole: string,
        reviewerName: string | undefined,
        dto: ApproveSettlementDTO
    ) {
        return await AppDataSource.transaction(async (manager) => {
            const request = await manager.getRepository(PaymentRequests)
                .createQueryBuilder("pr")
                .setLock("pessimistic_write")
                .where("pr.id = :id", { id })
                .getOne();

            if (!request) throw new Error("Không tìm thấy yêu cầu thanh toán");

            if (!ACCOUNTANT_ROLES.includes(reviewerRole as UserRole)) {
                throw new Error("Bạn không có quyền phê duyệt quyết toán hoàn ứng");
            }

            if (request.requesterId === reviewerId) {
                throw new Error("Người tạo phiếu không được tự phê duyệt quyết toán của chính mình");
            }

            if (request.settlementStatus !== PaymentSettlementStatus.SETTLEMENT_SUBMITTED) {
                throw new Error("Phiếu chưa ở trạng thái chờ duyệt quyết toán");
            }

            const diff = Math.round(Number(request.settlementDifference || 0));
            if (diff !== 0 && !dto.refundConfirmed) {
                const msg = diff < 0
                    ? `Vui lòng xác nhận Kế toán đã thu đủ số tiền thừa (${Math.abs(diff).toLocaleString("vi-VN")}đ) trước khi duyệt`
                    : `Vui lòng xác nhận Kế toán đã chi bù số tiền thiếu (${diff.toLocaleString("vi-VN")}đ) trước khi duyệt`;
                throw new Error(msg);
            }

            // Bắt buộc Kế toán phải tải lên minh chứng xét duyệt quyết toán hoàn ứng
            const accountantProofs = Array.isArray(dto.refundProofFiles) ? dto.refundProofFiles : [];
            if (accountantProofs.length === 0) {
                throw new Error("Bắt buộc phải tải lên minh chứng khi xét duyệt quyết toán hoàn ứng (Phiếu thu / Phiếu chi / Biên bản đối soát)");
            }

            // Ghi nhận chứng từ Kế toán tải lên vào settlementFiles
            const formattedAccountantProofs = accountantProofs.map((f) => ({
                ...f,
                docType: f.docType || (diff < 0 ? "REFUND_RECEIPT" : diff > 0 ? "REIMBURSEMENT_PROOF" : "SETTLEMENT_REVIEW_PROOF"),
                uploadedAt: f.uploadedAt || new Date().toISOString()
            }));
            request.settlementFiles = [...(request.settlementFiles || []), ...formattedAccountantProofs];

            // Tự động khớp sổ quỹ khi chi bù:
            if (diff > 0) {
                const reimbursementTxn: PaymentTransactionRecord = {
                    id: crypto.randomUUID(),
                    amount: diff,
                    paidAt: new Date().toISOString(),
                    payerId: reviewerId,
                    payerName: reviewerName,
                    paymentMethod: dto.refundPaymentMethod || "BANK_TRANSFER",
                    proofFiles: formattedAccountantProofs,
                    note: `Chi bù quyết toán hoàn ứng: ${diff.toLocaleString("vi-VN")}đ`
                };
                request.paymentTransactions = [...(request.paymentTransactions || []), reimbursementTxn];
                request.paymentProofs = [...(request.paymentProofs || []), ...reimbursementTxn.proofFiles];
                request.paidAmount = Math.round(Number(request.paidAmount || 0)) + diff;
            }

            request.settlementRefundConfirmed = Boolean(dto.refundConfirmed);
            request.settlementStatus = PaymentSettlementStatus.SETTLED;

            const historyNote = diff < 0
                ? `Duyệt quyết toán thành công. (Đã thu hồi tiền thừa: ${Math.abs(diff).toLocaleString("vi-VN")}đ)${dto.note ? ` - Ghi chú: ${dto.note}` : ""}`
                : diff > 0
                    ? `Duyệt quyết toán thành công. (Đã chi bù: ${diff.toLocaleString("vi-VN")}đ)${dto.note ? ` - Ghi chú: ${dto.note}` : ""}`
                    : `Duyệt quyết toán thành công (Khớp 100% tạm ứng)${dto.note ? ` - Ghi chú: ${dto.note}` : ""}`;

            this.pushHistory(request, {
                action: "APPROVE_SETTLEMENT",
                byId: reviewerId,
                note: historyNote
            });

            const saved = await manager.getRepository(PaymentRequests).save(request);

            await this.notifyUser(saved.requesterId, {
                title: "Quyết toán hoàn ứng đã được duyệt",
                content: `Hồ sơ quyết toán cho phiếu "${saved.content}" đã được duyệt thành công.`,
                type: "PAYMENT_REQUEST_SETTLEMENT_APPROVED",
                relatedEntityId: saved.id,
                link: `/payment-requests/${saved.id}`
            }, manager);

            return saved;
        });
    }

    async addSettlementFiles(id: string, files: PaymentRequestFile | PaymentRequestFile[], actorId: string, actorRole?: string) {
        return await AppDataSource.transaction(async (manager) => {
            const request = await manager.getRepository(PaymentRequests)
                .createQueryBuilder("pr")
                .setLock("pessimistic_write")
                .where("pr.id = :id", { id })
                .getOne();

            if (!request) throw new Error("Không tìm thấy yêu cầu thanh toán");
            if (request.type !== PaymentRequestType.ADVANCE) {
                throw new Error("Chỉ áp dụng bổ sung chứng từ quyết toán cho yêu cầu Tạm ứng");
            }

            const fileList = Array.isArray(files) ? files : [files];
            if (!fileList.length) throw new Error("Danh sách file trống");

            const formattedFiles = fileList.map((f) => ({
                ...f,
                uploadedAt: f.uploadedAt || new Date().toISOString()
            }));

            request.settlementFiles = [...(request.settlementFiles || []), ...formattedFiles];

            const refundCount = formattedFiles.filter((f) => f.docType === "REFUND_PROOF").length;
            const historyNote = refundCount > 0
                ? `Bổ sung ${refundCount} minh chứng hoàn trả tiền thừa về quỹ`
                : `Bổ sung ${formattedFiles.length} file chứng từ quyết toán`;

            this.pushHistory(request, {
                action: "SUPPLEMENTED",
                byId: actorId,
                note: historyNote
            });

            return await manager.getRepository(PaymentRequests).save(request);
        });
    }

    async rejectSettlement(id: string, reviewerId: string, reviewerRole: string, reason: string) {
        if (!reason || !reason.trim()) {
            throw new Error("Vui lòng nhập lý do từ chối quyết toán");
        }

        return await AppDataSource.transaction(async (manager) => {
            const request = await manager.getRepository(PaymentRequests)
                .createQueryBuilder("pr")
                .setLock("pessimistic_write")
                .where("pr.id = :id", { id })
                .getOne();

            if (!request) throw new Error("Không tìm thấy yêu cầu thanh toán");

            if (!ACCOUNTANT_ROLES.includes(reviewerRole as UserRole)) {
                throw new Error("Bạn không có quyền từ chối quyết toán hoàn ứng");
            }

            if (request.requesterId === reviewerId) {
                throw new Error("Người tạo phiếu không được tự thao tác trên quyết toán của chính mình");
            }

            if (request.settlementStatus !== PaymentSettlementStatus.SETTLEMENT_SUBMITTED) {
                throw new Error("Phiếu chưa ở trạng thái chờ duyệt quyết toán");
            }

            request.settlementStatus = PaymentSettlementStatus.WAITING_SETTLEMENT;
            this.pushHistory(request, {
                action: "REJECT_SETTLEMENT",
                byId: reviewerId,
                note: `Yêu cầu làm lại quyết toán: ${reason.trim()}`
            });

            const saved = await manager.getRepository(PaymentRequests).save(request);

            await this.notifyUser(saved.requesterId, {
                title: "Quyết toán hoàn ứng bị từ chối",
                content: `Hồ sơ quyết toán cho phiếu "${saved.content}" đã bị từ chối: ${reason.trim()}. Vui lòng chỉnh sửa và nộp lại.`,
                type: "PAYMENT_REQUEST_SETTLEMENT_REJECTED",
                relatedEntityId: saved.id,
                link: `/payment-requests/${saved.id}`
            }, manager);

            return saved;
        });
    }

    async pay(id: string, dto: {
        paymentMethod?: PaymentMethod;
        paymentProofs?: PaymentRequestFile[];
        cashVoucherInfo?: CashVoucherInfo;
    }, payerId?: string, payerRole?: string, payerName?: string) {
        return await this.recordPayment(
            id,
            {
                paymentMethod: dto.paymentMethod || PaymentMethod.BANK_TRANSFER,
                paymentProofs: dto.paymentProofs,
                cashVoucherInfo: dto.cashVoucherInfo,
                paidAmountThisTime: undefined
            },
            payerId || "system",
            payerRole || UserRole.ADMIN,
            payerName
        );
    }

    async uploadPaymentProof(id: string, file: PaymentRequestFile) {
        const request = await this.getOne(id);
        request.paymentProofs = [...(request.paymentProofs || []), { ...file, uploadedAt: new Date().toISOString() }];
        return await this.repo.save(request);
    }

    async cancel(id: string, actorId: string, actorRole: string, reason?: string) {
        const request = await this.getOne(id);

        if (request.paidAt || request.paymentStatus === PaymentDueStatus.PAID) {
            throw new Error("Yêu cầu thanh toán đã được chi tiền, không thể hủy");
        }
        if (request.approvalStatus === PaymentRequestApprovalStatus.CANCELLED) {
            throw new Error("Yêu cầu thanh toán đã bị hủy trước đó");
        }
        if (request.approvalStatus === PaymentRequestApprovalStatus.REJECTED) {
            throw new Error("Yêu cầu thanh toán đã bị từ chối, không thể hủy");
        }

        const isBodOrAdmin = [UserRole.BOD, UserRole.ADMIN].includes(actorRole as UserRole);

        if (request.approvalStatus === PaymentRequestApprovalStatus.APPROVED) {
            if (!isBodOrAdmin) {
                throw new Error("Bạn không có quyền hủy yêu cầu thanh toán đã được duyệt");
            }
            if (!reason) {
                throw new Error("Vui lòng nhập lý do hủy");
            }
            if (request.taskId) {
                const task = await this.taskRepo.findOne({ where: { id: request.taskId } });
                if (task) {
                    task.spentAmount = Math.max(0, Number(task.spentAmount || 0) - Number(request.amount));
                    await this.taskRepo.save(task);
                }
            }
        } else {
            if (request.requesterId !== actorId && !isBodOrAdmin) {
                throw new Error("Bạn không phải người tạo yêu cầu này");
            }
        }

        request.approvalStatus = PaymentRequestApprovalStatus.CANCELLED;
        if (request.type === PaymentRequestType.ADVANCE) {
            request.settlementStatus = PaymentSettlementStatus.NOT_APPLICABLE;
        }
        this.pushHistory(request, { action: "CANCELLED", byId: actorId, note: reason || null });
        const saved = await this.repo.save(request);

        await this.notifyUser(saved.requesterId, {
            title: "Yêu cầu thanh toán đã bị hủy",
            content: `Yêu cầu thanh toán "${saved.content}" đã bị hủy${reason ? `: ${reason}` : "."}`,
            type: "PAYMENT_REQUEST_CANCELLED",
            relatedEntityId: saved.id,
            link: `/payment-requests/${saved.id}`
        });

        if (saved.requesterId !== actorId) {
            await this.notifyRoles(REVIEWER_NOTIFY_ROLES, {
                title: "Yêu cầu thanh toán đã bị hủy",
                content: `Yêu cầu thanh toán "${saved.content}" đã bị hủy${reason ? `: ${reason}` : "."}`,
                type: "PAYMENT_REQUEST_CANCELLED",
                relatedEntityId: saved.id,
                link: `/payment-requests/${saved.id}`,
                excludeUserId: actorId
            });
        }

        return saved;
    }

    async cancelPendingForTask(taskId: string, actorId: string, manager?: EntityManager) {
        const repo = manager ? manager.getRepository(PaymentRequests) : this.repo;
        const taskRepo = manager ? manager.getRepository(Tasks) : this.taskRepo;

        const pending = await repo.find({
            where: {
                taskId,
                approvalStatus: In([
                    PaymentRequestApprovalStatus.DRAFT,
                    PaymentRequestApprovalStatus.PENDING_REVIEWER,
                    PaymentRequestApprovalStatus.NEED_MORE_DOCS,
                    PaymentRequestApprovalStatus.PENDING_BOD
                ])
            }
        });

        for (const request of pending) {
            request.approvalStatus = PaymentRequestApprovalStatus.CANCELLED;
            if (request.type === PaymentRequestType.ADVANCE) {
                request.settlementStatus = PaymentSettlementStatus.NOT_APPLICABLE;
            }
            this.pushHistory(request, {
                action: "CANCELLED",
                byId: actorId,
                note: "Tự động hủy do công việc bị đổi phân công"
            });
            await repo.save(request);
        }

        const approvedUnpaid = await repo.find({
            where: {
                taskId,
                approvalStatus: PaymentRequestApprovalStatus.APPROVED,
                paidAt: IsNull()
            }
        });

        if (approvedUnpaid.length > 0) {
            throw new Error("Công việc này còn yêu cầu thanh toán đã được duyệt nhưng chưa chi tiền, vui lòng xử lý trước khi thay đổi phân công");
        }

        const task = await taskRepo.findOne({ where: { id: taskId } });
        return task;
    }

    async delete(id: string) {
        const request = await this.getOne(id);
        if (request.approvalStatus !== PaymentRequestApprovalStatus.DRAFT) {
            throw new Error("Chỉ xóa được yêu cầu thanh toán ở trạng thái nháp");
        }
        await this.repo.remove(request);
        return { message: "Đã xóa yêu cầu thanh toán" };
    }

    async getTaskSpent(taskId: string) {
        const task = await this.taskRepo.findOne({ where: { id: taskId } });
        if (!task) {
            throw new Error("Không tìm thấy công việc");
        }

        const cost = Number(task.cost || 0);
        const spentAmount = Number(task.spentAmount || 0);

        return {
            taskId,
            cost,
            spentAmount,
            remainingAmount: cost - spentAmount
        };
    }

    async getTotalDebt(query: PaymentRequestQuery, viewer?: PaymentRequestViewer) {
        const qb = this.repo.createQueryBuilder("pr")
            .where("pr.approvalStatus = :approved", { approved: PaymentRequestApprovalStatus.APPROVED })
            .andWhere("pr.paidAt IS NULL");

        if (query.search) {
            qb.andWhere("pr.content ILIKE :search", { search: `%${query.search}%` });
        }
        if (query.type === ("DIRECT_PAYMENT" as any)) {
            qb.andWhere("pr.type != :advanceType", { advanceType: PaymentRequestType.ADVANCE });
        } else if (isValidRequestType(query.type)) {
            qb.andWhere("pr.type = :type", { type: query.type });
        }
        if (query.projectId) {
            qb.andWhere("pr.projectId = :projectId", { projectId: query.projectId });
        }

        const dateCol = query.dateField === "createdAt" ? "pr.createdAt" : "COALESCE(pr.confirmedDueDate, pr.dueDate)";
        if (query.fromDate) {
            qb.andWhere(`${dateCol} >= :fromDate`, { fromDate: new Date(`${query.fromDate}T00:00:00.000`) });
        }
        if (query.toDate) {
            qb.andWhere(`${dateCol} <= :toDate`, { toDate: new Date(`${query.toDate}T23:59:59.999`) });
        }

        if (query.minAmount !== undefined && query.minAmount !== "" && !isNaN(Number(query.minAmount))) {
            qb.andWhere("pr.amount >= :minAmount", { minAmount: Number(query.minAmount) });
        }
        if (query.maxAmount !== undefined && query.maxAmount !== "" && !isNaN(Number(query.maxAmount))) {
            qb.andWhere("pr.amount <= :maxAmount", { maxAmount: Number(query.maxAmount) });
        }

        if (viewer && !FULL_VISIBILITY_ROLES.includes(viewer.role as UserRole)) {
            qb.andWhere("pr.requesterId = :viewerId", { viewerId: viewer.userId });
        }

        const raw = await qb.select([
            "COALESCE(SUM(pr.amount - COALESCE(pr.paidAmount, 0)), 0) AS total",
            "COALESCE(SUM(CASE WHEN pr.type = 'PROJECT' THEN (pr.amount - COALESCE(pr.paidAmount, 0)) ELSE 0 END), 0) AS project_debt",
            "COALESCE(SUM(CASE WHEN pr.type = 'OTHER_WORK' THEN (pr.amount - COALESCE(pr.paidAmount, 0)) ELSE 0 END), 0) AS other_work_debt",
            "COALESCE(SUM(CASE WHEN pr.type = 'ADVANCE' THEN (pr.amount - COALESCE(pr.paidAmount, 0)) ELSE 0 END), 0) AS advance_debt",
            "COALESCE(SUM(CASE WHEN pr.type != 'ADVANCE' THEN (pr.amount - COALESCE(pr.paidAmount, 0)) ELSE 0 END), 0) AS direct_payment_debt"
        ]).getRawOne();

        return {
            totalDebt: Number(raw?.total || 0),
            projectDebt: Number(raw?.project_debt || 0),
            otherWorkDebt: Number(raw?.other_work_debt || 0),
            advanceDebt: Number(raw?.advance_debt || 0),
            directPaymentDebt: Number(raw?.direct_payment_debt || 0)
        };
    }

    async getDocPreviewData(id: string): Promise<any> {
        const repo = AppDataSource.getRepository(PaymentRequests);
        const request = await repo.findOne({
            where: { id },
            relations: ["requester", "project", "task"]
        });

        if (!request) {
            throw new Error("Không tìm thấy yêu cầu thanh toán");
        }

        const d = request.createdAt ? new Date(request.createdAt) : new Date();
        const requestDate = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

        let dueDate = "";
        const targetDate = request.confirmedDueDate || request.dueDate || request.settlementDueDate;
        if (targetDate) {
            const dd = new Date(targetDate);
            dueDate = `${String(dd.getDate()).padStart(2, '0')}/${String(dd.getMonth() + 1).padStart(2, '0')}/${dd.getFullYear()}`;
        } else {
            dueDate = requestDate;
        }

        const requesterName = request.requester?.fullName || "Người đề nghị";
        const position = (request.requester as any)?.position || "Nhân viên";
        const department = (request.requester as any)?.department || "Dự án";
        const reason = request.content || "";
        const amount = Number(request.amount) || 0;
        const amountInWords = readMoneyToWords(amount, "");

        const proofBillUrl =
            (request.invoiceImages && request.invoiceImages[0]?.url) ||
            (request.invoicePdfs && request.invoicePdfs.find((p: any) => p.docType !== "PAYMENT_REQUEST_DOC")?.url) ||
            "";

        // Lấy STT tiếp theo từ sheet
        let nextStt = "01";
        try {
            const config = getGoogleConfig();
            if (config.paymentRequestSpreadsheetId) {
                const sheets = getGoogleSheetsClient();
                const tabName = config.paymentRequestSheetTab || "TH_GIẤY ĐỀ NGHỊ THANH TOÁN";
                const res = await sheets.spreadsheets.values.get({
                    spreadsheetId: config.paymentRequestSpreadsheetId,
                    range: `'${tabName}'!A:A`
                });
                const values = res.data.values || [];
                const filled = values.slice(1).filter(r => r[0] && String(r[0]).trim());
                nextStt = String(filled.length + 1).padStart(2, "0");
            }
        } catch (e: any) {
            console.warn("[getDocPreviewData] Lỗi lấy STT từ Google Sheet:", e?.message);
        }

        const docService = new PaymentRequestDocumentService();
        const standardFileName = docService.generateStandardFileName({
            voucherNo: nextStt,
            requesterName,
            requestDate,
            amount,
            reason
        });

        return {
            id: request.id,
            stt: nextStt,
            requesterName,
            requestDate,
            position,
            department,
            amount,
            amountFormatted: amount.toLocaleString("vi-VN"),
            amountInWords,
            reason,
            dueDate,
            proofBillUrl,
            standardFileName,
            projectId: request.projectId || null,
            projectName: request.project?.name || "",
            invoicePdfs: request.invoicePdfs || [],
            type: request.type
        };
    }

    async generateWordFile(id: string, customData?: any): Promise<{ buffer: Buffer; fileName: string }> {
        const preview = await this.getDocPreviewData(id);
        let docInput: FillPaymentRequestDocInput = {
            voucherNo: customData?.stt || preview.stt,
            requestDate: customData?.requestDate || preview.requestDate,
            requesterName: customData?.requesterName || preview.requesterName,
            position: customData?.position || preview.position,
            department: customData?.department || preview.department,
            amount: customData?.amount !== undefined ? customData.amount : preview.amount,
            amountInWords: customData?.amountInWords || preview.amountInWords,
            reason: customData?.reason || preview.reason,
            dueDate: customData?.dueDate || preview.dueDate,
            projectName: preview.projectName,
            customFileName: customData?.customFileName
        };

        // Đảm bảo không trùng STT khi tải file
        docInput = await this.resolveUniqueVoucherNo(docInput, (preview as any).projectId);

        const docService = new PaymentRequestDocumentService();
        const buffer = await docService.generateWordDocument(docInput);
        const baseName = docService.generateStandardFileName(docInput);
        const fileName = `${baseName}.docx`;

        return { buffer, fileName };
    }

    async syncToGoogleSheet(
        id: string,
        customData?: Partial<PaymentRequestSheetRow> & { customFileName?: string; force?: boolean }
    ): Promise<{
        success: boolean;
        updatedRange: string;
        spreadsheetUrl: string;
        rowIndex: number;
        message: string;
        wordFileUrl?: string;
        wordFileName?: string;
    }> {
        const preview = await this.getDocPreviewData(id);

        const stt = customData?.stt ? String(customData.stt).padStart(2, "0") : preview.stt;
        const requesterName = customData?.requesterName || preview.requesterName;
        const requestDate = customData?.requestDate || preview.requestDate;
        const position = customData?.position || preview.position;
        const department = customData?.department || preview.department;
        const amount = customData?.amount !== undefined ? customData.amount : preview.amount;
        const amountInWords = customData?.amountInWords || preview.amountInWords;
        const reason = customData?.reason || preview.reason;
        const dueDate = customData?.dueDate || preview.dueDate;
        const proofBillUrl = customData?.proofBillUrl || preview.proofBillUrl;

        const docInput: FillPaymentRequestDocInput = {
            voucherNo: stt,
            requestDate,
            requesterName,
            position,
            department,
            amount,
            amountInWords,
            reason,
            dueDate,
            projectName: preview.projectName,
            customFileName: customData?.customFileName
        };

        // Tái sử dụng link tài liệu đề nghị thanh toán đã có trong invoicePdfs nếu tồn tại
        const existingDoc = (preview as any)?.invoicePdfs?.find?.(
            (p: any) => p.docType === "PAYMENT_REQUEST_DOC" && p.url
        );

        // Nếu người dùng không tạo hoặc không đính kèm file Word, không đồng bộ sang Google Sheet
        const linkWord01 = customData?.linkWord01 || existingDoc?.url || "";
        if (!linkWord01 && !customData?.force) {
            return {
                success: false,
                updatedRange: "",
                spreadsheetUrl: "",
                rowIndex: 0,
                message: "Yêu cầu thanh toán chưa có Giấy đề nghị thanh toán (file Word) nên chưa đồng bộ sang Google Sheet",
                wordFileUrl: "",
                wordFileName: ""
            };
        }

        const generateWordStatus = linkWord01 ? "TRUE" : (customData?.generateWordStatus || "FALSE");

        const rowData: PaymentRequestSheetRow = {
            stt,
            requesterName,
            requestDate,
            position,
            department,
            amount,
            amountInWords,
            reason,
            dueDate,
            linkWord01,
            linkWord02: customData?.linkWord02 || "",
            linkWord03: customData?.linkWord03 || "",
            generateWordStatus,
            proofBillUrl
        };

        const googleSheetService = new GoogleSheetService();
        const result = await googleSheetService.appendPaymentRequestRow(rowData);

        return {
            success: true,
            updatedRange: result.updatedRange,
            spreadsheetUrl: result.spreadsheetUrl,
            rowIndex: result.rowIndex,
            wordFileUrl: linkWord01 || undefined,
            wordFileName: existingDoc?.name || (linkWord01 ? "GiayDeNghiThanhToan.docx" : undefined),
            message: `Đã đồng bộ thành công vào dòng ${result.rowIndex} của tab TH_GIẤY ĐỀ NGHỊ THANH TOÁN`
        };
    }
}

