import { Request, Response } from "express";
import { PaymentRequestService } from "../services/PaymentRequest.Service";
import { AuthRequest } from "../../../shared/middlewares/Auth.Middleware";
import { uploadToCloudinary } from "../../../shared/helpers/cloudinary.helper";
import { PaymentRequestDocumentService } from "../services/PaymentRequestDocument.Service";
import { getGoogleConfig, getGoogleSheetsClient } from "../../../shared/config/google";

export class PaymentRequestController {
    private service = new PaymentRequestService();

    // Upload file hóa đơn (ảnh hoặc PDF) trước khi tạo/cập nhật yêu cầu thanh toán.
    // Trả về metadata file (name, url, size, ...) để FE gắn vào invoiceImages/invoicePdfs.
    uploadInvoice = async (req: any, res: Response) => {
        try {
            const file = req.file as Express.Multer.File | undefined;
            if (!file) {
                return res.status(400).json({ message: "Vui lòng chọn file hóa đơn" });
            }

            const isImage = file.mimetype.startsWith("image/");
            const isPdf = file.mimetype === "application/pdf" || (file.originalname && file.originalname.toLowerCase().endsWith(".pdf"));
            const isDoc = file.mimetype === "application/msword" ||
                file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
                (file.originalname && (file.originalname.toLowerCase().endsWith(".doc") || file.originalname.toLowerCase().endsWith(".docx")));

            if (!isImage && !isPdf && !isDoc) {
                return res.status(400).json({ message: "Chỉ chấp nhận file ảnh (jpg, png...), PDF hoặc Word (doc, docx)" });
            }

            const uploaded = await uploadToCloudinary(file, "ERP/PAYMENT_REQUESTS/invoices");
            const fileType = isPdf ? "PDF" : (isDoc ? "DOC" : "IMAGE");
            res.status(201).json({ ...uploaded, fileType });
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }

    create = async (req: AuthRequest, res: Response) => {
        try {
            const requesterId = req.user?.userId || req.user?.id as string;
            const result = await this.service.create(req.body, requesterId);
            res.status(201).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }

    getAll = async (req: AuthRequest, res: Response) => {
        try {
            const viewerId = req.user?.userId || req.user?.id;
            const viewer = viewerId ? { userId: viewerId, role: req.user?.role as string } : undefined;
            const result = await this.service.getAll(req.query as any, viewer);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(500).json({ message: error.message });
        }
    }

    getTotalDebt = async (req: AuthRequest, res: Response) => {
        try {
            const viewerId = req.user?.userId || req.user?.id;
            const viewer = viewerId ? { userId: viewerId, role: req.user?.role as string } : undefined;
            const result = await this.service.getTotalDebt(req.query as any, viewer);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(500).json({ message: error.message });
        }
    }

    getServiceBudget = async (req: Request, res: Response) => {
        try {
            const { projectId, taskId, excludeRequestId } = req.query;
            if (!projectId || !taskId) {
                return res.status(400).json({ message: "Vui lòng truyền projectId và taskId" });
            }
            const result = await this.service.getServiceBudgetInfo(
                projectId as string,
                taskId as string,
                excludeRequestId ? (excludeRequestId as string) : undefined
            );
            res.status(200).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }

    getProjectBudgetSummary = async (req: Request, res: Response) => {
        try {
            const projectId = req.params.projectId as string;
            const result = await this.service.getProjectBudgetSummary(projectId);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }

    getTaskSpent = async (req: Request, res: Response) => {
        try {
            const result = await this.service.getTaskSpent(req.params.taskId as string);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }

    getOne = async (req: AuthRequest, res: Response) => {
        try {
            const viewerId = req.user?.userId || req.user?.id;
            const viewer = viewerId ? { userId: viewerId, role: req.user?.role as string } : undefined;
            const result = await this.service.getOne(req.params.id as string, viewer);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(404).json({ message: error.message });
        }
    }

    update = async (req: Request, res: Response) => {
        try {
            const result = await this.service.update(req.params.id as string, req.body);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }

    // Gửi duyệt yêu cầu đang ở trạng thái nháp (áp dụng cho cả yêu cầu tự tạo cho vendor)
    submit = async (req: AuthRequest, res: Response) => {
        try {
            const requesterId = req.user?.userId || req.user?.id as string;
            const result = await this.service.submit(req.params.id as string, requesterId);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }

    // Người tạo bổ sung hồ sơ/nội dung khi yêu cầu đang ở trạng thái "Cần bổ sung" (giữ lại lịch sử)
    supplement = async (req: AuthRequest, res: Response) => {
        try {
            const requesterId = req.user?.userId || req.user?.id as string;
            const result = await this.service.supplement(req.params.id as string, req.body, requesterId);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }

    addInvoicePdf = async (req: Request, res: Response) => {
        try {
            const result = await this.service.addInvoicePdf(req.params.id as string, req.body);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }

    review = async (req: AuthRequest, res: Response) => {
        try {
            const { action, note } = req.body;
            const reviewerId = req.user?.userId || req.user?.id as string;
            const result = await this.service.review(req.params.id as string, action, note, reviewerId, req.user?.role as string);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }

    bodDecision = async (req: AuthRequest, res: Response) => {
        try {
            const { action, reason, confirmedDueDate } = req.body;
            const bodUserId = req.user?.userId || req.user?.id as string;
            const result = await this.service.bodDecision(req.params.id as string, action, reason, bodUserId, confirmedDueDate);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }

    recordPayment = async (req: AuthRequest, res: Response) => {
        try {
            const payerId = req.user?.userId || req.user?.id as string;
            const payerRole = req.user?.role as string;
            const payerName = req.user?.username;
            const result = await this.service.recordPayment(req.params.id as string, req.body, payerId, payerRole, payerName);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }

    submitSettlement = async (req: AuthRequest, res: Response) => {
        try {
            const requesterId = req.user?.userId || req.user?.id as string;
            const result = await this.service.submitSettlement(req.params.id as string, req.body, requesterId);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }

    approveSettlement = async (req: AuthRequest, res: Response) => {
        try {
            const reviewerId = req.user?.userId || req.user?.id as string;
            const reviewerRole = req.user?.role as string;
            const reviewerName = req.user?.username;
            const result = await this.service.approveSettlement(req.params.id as string, reviewerId, reviewerRole, reviewerName, req.body);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }

    rejectSettlement = async (req: AuthRequest, res: Response) => {
        try {
            const reviewerId = req.user?.userId || req.user?.id as string;
            const reviewerRole = req.user?.role as string;
            const { reason } = req.body;
            const result = await this.service.rejectSettlement(req.params.id as string, reviewerId, reviewerRole, reason);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }

    addSettlementFiles = async (req: AuthRequest, res: Response) => {
        try {
            const actorId = req.user?.userId || req.user?.id as string;
            const actorRole = req.user?.role as string;
            const { files } = req.body;
            const result = await this.service.addSettlementFiles(req.params.id as string, files, actorId, actorRole);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }

    pay = async (req: AuthRequest, res: Response) => {
        try {
            const payerId = req.user?.userId || req.user?.id as string;
            const payerRole = req.user?.role as string;
            const payerName = req.user?.username;
            const result = await this.service.pay(req.params.id as string, req.body, payerId, payerRole, payerName);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }

    uploadPaymentProof = async (req: Request, res: Response) => {
        try {
            const result = await this.service.uploadPaymentProof(req.params.id as string, req.body);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }

    cancel = async (req: AuthRequest, res: Response) => {
        try {
            const actorId = req.user?.userId || req.user?.id as string;
            const { reason } = req.body;
            const result = await this.service.cancel(req.params.id as string, actorId, req.user?.role as string, reason);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }

    delete = async (req: Request, res: Response) => {
        try {
            const result = await this.service.delete(req.params.id as string);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }

    getDocPreview = async (req: AuthRequest, res: Response) => {
        try {
            const result = await this.service.getDocPreviewData(req.params.id as string);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }

    downloadWord = async (req: AuthRequest, res: Response) => {
        try {
            const { buffer, fileName } = await this.service.generateWordFile(req.params.id as string, req.query as any);
            res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
            res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(fileName)}"`);
            res.send(buffer);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }

    getNextStt = async (req: Request, res: Response) => {
        try {
            const config = getGoogleConfig();
            let nextStt = "01";
            if (config.paymentRequestSpreadsheetId) {
                const sheets = getGoogleSheetsClient();
                const tabName = config.paymentRequestSheetTab || "TH_GIẤY ĐỀ NGHỊ THANH TOÁN";
                const response = await sheets.spreadsheets.values.get({
                    spreadsheetId: config.paymentRequestSpreadsheetId,
                    range: `'${tabName}'!A:B`
                });
                const values = response.data.values || [];
                const filled = values.slice(1).filter(r => (r[1] && String(r[1]).trim()) || (r[0] && String(r[0]).trim()));
                nextStt = String(filled.length + 1).padStart(2, "0");
            }
            res.status(200).json({ nextStt });
        } catch (error: any) {
            res.status(200).json({ nextStt: "01" });
        }
    }

    downloadTemplateWord = async (req: Request, res: Response) => {
        try {
            const query = req.query as any;
            const input: any = {
                voucherNo: query.voucherNo || query.stt,
                requesterName: query.requesterName,
                requestDate: query.requestDate,
                position: query.position,
                department: query.department,
                amount: query.amount,
                amountInWords: query.amountInWords,
                reason: query.reason,
                dueDate: query.dueDate,
                projectName: query.projectName,
                customFileName: query.customFileName
            };
            const docService = new PaymentRequestDocumentService();
            const buffer = await docService.generateWordDocument(input);
            const baseName = docService.generateStandardFileName(input);
            const fileName = `${baseName}.docx`;
            res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
            res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(fileName)}"`);
            res.send(buffer);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }

    generateWordAndUpload = async (req: Request, res: Response) => {
        try {
            const input = req.body;
            let resolvedInput = input;
            if (input && input.voucherNo) {
                resolvedInput = await this.service.resolveUniqueVoucherNo(input, input.projectId);
            }
            const docService = new PaymentRequestDocumentService();
            const docResult = await docService.generateAndUploadToDrive(resolvedInput);
            const fileNameWithExt = `${docResult.fileName}.docx`;
            const displayFileName = resolvedInput.displayFileName || fileNameWithExt;

            res.status(200).json({
                url: docResult?.webViewLink || "",
                driveFileId: docResult?.driveFileId || null,
                name: displayFileName,
                standardName: displayFileName,
                safeUploadName: fileNameWithExt,
                originalName: fileNameWithExt,
                fileType: "DOC",
                docType: "PAYMENT_REQUEST_DOC",
                size: docResult.buffer ? docResult.buffer.length : 0,
                voucherNo: resolvedInput.voucherNo
            });
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }

    syncGoogleSheet = async (req: AuthRequest, res: Response) => {
        try {
            const result = await this.service.syncToGoogleSheet(req.params.id as string, req.body);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }
}

