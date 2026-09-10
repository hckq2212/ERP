import { Response } from "express";
import { AuthRequest } from "../../../shared/middlewares/Auth.Middleware";
import { QcService } from "../services/Qc.Service";

const ALLOWED_EXTENSIONS = [".xlsx", ".xlsm"];

export class QcController {
    private service = new QcService();

    sheets = async (req: AuthRequest, res: Response) => {
        try {
            const file = (req as any).file;
            if (!file) {
                return res.status(400).json({ message: "Vui lòng chọn file" });
            }
            const ext = "." + (file.originalname.split(".").pop() || "").toLowerCase();
            if (!ALLOWED_EXTENSIONS.includes(ext)) {
                return res.status(400).json({ message: `Định dạng ${ext} chưa được hỗ trợ QC` });
            }
            const result = await this.service.listSheets(file.buffer, file.originalname);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(error.response?.status || error.statusCode || 500).json({ message: error.response?.data?.detail || error.message });
        }
    };

    sheetsFromUrl = async (req: AuthRequest, res: Response) => {
        try {
            const { fileUrl, fileName } = req.body;
            if (!fileUrl || !fileName) {
                return res.status(400).json({ message: "Thiếu fileUrl hoặc fileName" });
            }
            const ext = "." + (fileName.split(".").pop() || "").toLowerCase();
            if (!ALLOWED_EXTENSIONS.includes(ext)) {
                return res.status(400).json({ message: `Định dạng ${ext} chưa được hỗ trợ QC` });
            }
            const result = await this.service.listSheetsFromUrl(fileUrl, fileName);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(error.statusCode || error.response?.status || 500).json({ message: error.response?.data?.detail || error.message });
        }
    };

    run = async (req: AuthRequest, res: Response) => {
        try {
            const file = (req as any).file;
            const { fileUrl, fileName, sheetNames, projectId } = req.body;

            const sheetList = String(sheetNames || "")
                .split(",")
                .map((s: string) => s.trim())
                .filter(Boolean);

            if (sheetList.length === 0) {
                return res.status(400).json({ message: "Vui lòng chọn ít nhất 1 sheet để chạy QC" });
            }
            if (!projectId) {
                return res.status(400).json({ message: "Thiếu projectId" });
            }
            if (!file && !fileUrl) {
                return res.status(400).json({ message: "Cần cung cấp file hoặc url" });
            }

            const result = await this.service.run({
                fileBuffer: file?.buffer,
                fileName: file?.originalname || fileName,
                fileUrl,
                sheetNames: sheetList,
                projectId,
                actor: req.user as unknown as { id: string; userId?: string; role: string },
            });
            res.status(200).json(result);
        } catch (error: any) {
            res.status(error.statusCode || error.response?.status || 500).json({ message: error.response?.data?.detail || error.message });
        }
    };
}
