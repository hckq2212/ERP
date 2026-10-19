import * as fs from "fs";
import * as path from "path";
import JSZip from "jszip";
import { Readable } from "stream";
import { getGoogleConfig, getGoogleDriveClient } from "../../../shared/config/google";
import { readMoneyToWords } from "../../../shared/utils/numberToWordsVi";

export interface FillPaymentRequestDocInput {
    voucherNo?: string;            // Ví dụ: "01"
    requestDate?: string;          // DD/MM/YYYY
    requesterName: string;         // Võ Phạm Băng Tâm
    position?: string;             // Nhân viên
    department?: string;           // Dự án
    amount: number | string;       // 264.000 hoặc 264000
    amountInWords?: string;        // Hai trăm sáu mươi tư nghìn
    reason: string;                // mua trang phục cho talent bé trong dự án Nutifood.
    dueDate?: string;              // DD/MM/YYYY
    projectName?: string;          // Nutifood
    customFileName?: string;       // Tên file tùy chỉnh nếu có
}

export interface GeneratedDocResult {
    fileName: string;
    buffer: Buffer;
    driveFileId?: string;
    webViewLink?: string;
}

export function escapeXml(unsafe?: string | number | null): string {
    if (unsafe == null) return "";
    return String(unsafe)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

export class PaymentRequestDocumentService {
    private templatePath: string;

    constructor() {
        this.templatePath = path.resolve(__dirname, "../../../../assets/templates/GiayDeNghiThanhToan.docx");
        if (!fs.existsSync(this.templatePath)) {
            // Thử đường dẫn từ process.cwd()
            const altPath = path.resolve(process.cwd(), "assets/templates/GiayDeNghiThanhToan.docx");
            if (fs.existsSync(altPath)) {
                this.templatePath = altPath;
            }
        }
    }

    parseDateParts(dateStr?: string | Date): { dd: string; mm: string; yyyy: string; yy: string } {
        if (dateStr) {
            if (dateStr instanceof Date && !isNaN(dateStr.getTime())) {
                const dd = String(dateStr.getDate()).padStart(2, "0");
                const mm = String(dateStr.getMonth() + 1).padStart(2, "0");
                const yyyy = String(dateStr.getFullYear());
                return { dd, mm, yyyy, yy: yyyy.slice(-2) };
            }
            const s = String(dateStr).trim();
            if (s.includes("/")) {
                const [d, m, y] = s.split("/");
                if (d && m && y) {
                    const cleanY = y.split("T")[0].split(" ")[0];
                    return {
                        dd: d.padStart(2, "0"),
                        mm: m.padStart(2, "0"),
                        yyyy: cleanY.length === 2 ? `20${cleanY}` : cleanY,
                        yy: cleanY.slice(-2)
                    };
                }
            }
            if (s.includes("-")) {
                const parts = s.split("T")[0].split("-");
                if (parts.length === 3) {
                    if (parts[0].length === 4) {
                        // YYYY-MM-DD
                        return {
                            dd: parts[2].padStart(2, "0"),
                            mm: parts[1].padStart(2, "0"),
                            yyyy: parts[0],
                            yy: parts[0].slice(-2)
                        };
                    } else {
                        // DD-MM-YYYY
                        return {
                            dd: parts[0].padStart(2, "0"),
                            mm: parts[1].padStart(2, "0"),
                            yyyy: parts[2],
                            yy: parts[2].slice(-2)
                        };
                    }
                }
            }
        }
        const now = new Date();
        const dd = String(now.getDate()).padStart(2, "0");
        const mm = String(now.getMonth() + 1).padStart(2, "0");
        const yyyy = String(now.getFullYear());
        return { dd, mm, yyyy, yy: yyyy.slice(-2) };
    }

    /**
     * Tạo tên file chuẩn Getvini theo công thức:
     * ddMMyy_Duan_yyyy_DNTT-GETVINI
     */
    generateStandardFileName(input: FillPaymentRequestDocInput, docIndex = "01"): string {
        let customName = (input.customFileName || "").trim();
        if (customName) {
            customName = customName.replace(/\.docx$/i, "");
            customName = customName.replace(/cong[ _]viec[ _]khac/gi, "CongViecKhac");
            customName = customName.replace(/Cong_viec_khac/gi, "CongViecKhac");
            return customName;
        }
        const reqDate = this.parseDateParts(input.requestDate);
        const projectName = (input.projectName || "").trim();
        let cleanProject = "";
        const lowerProj = projectName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (!projectName) {
            cleanProject = "GETVINI";
        } else if (lowerProj.includes("cong viec khac") || lowerProj.includes("congvieckhac") || lowerProj.includes("cong_viec_khac")) {
            cleanProject = "CongViecKhac";
        } else {
            cleanProject = projectName
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .replace(/[^a-zA-Z0-9_-]/g, "_")
                .replace(/_+/g, "_")
                .replace(/^_+|_+$/g, "") || "GETVINI";
        }

        const stt = input.voucherNo ? String(input.voucherNo).padStart(2, "0") : (docIndex ? String(docIndex).padStart(2, "0") : "01");
        return `${reqDate.dd}${reqDate.mm}${reqDate.yy}_${cleanProject}_${reqDate.yyyy}_DNTT-GETVINI_${stt}`;
    }

    /**
     * Điền thông tin vào các vị trí dấu "…" trong template Word GiayDeNghiThanhToan.docx
     */
    async generateWordDocument(input: FillPaymentRequestDocInput): Promise<Buffer> {
        if (!fs.existsSync(this.templatePath)) {
            throw new Error(`Không tìm thấy file mẫu Word tại: ${this.templatePath}`);
        }

        const templateBuf = fs.readFileSync(this.templatePath);
        const zip = await JSZip.loadAsync(templateBuf);
        let docXml = await zip.file("word/document.xml")!.async("text");
        docXml = docXml.replace(/<w:r\b[^>]*>(?:(?!<w:r\b)[\s\S])*?<mc:AlternateContent[\s\S]*?<\/mc:AlternateContent>[\s\S]*?<\/w:r>/g, "");

        const reqDate = this.parseDateParts(input.requestDate);
        const dueDate = this.parseDateParts(input.dueDate || input.requestDate);

        const rawAmount = typeof input.amount === "number" ? input.amount : Number(String(input.amount).replace(/\D/g, "")) || 0;
        const formattedAmount = rawAmount > 0 ? rawAmount.toLocaleString("vi-VN") : "0";
        const words = input.amountInWords || readMoneyToWords(rawAmount, "");

        // 1. Số: …
        const voucherNo = input.voucherNo ? String(input.voucherNo).padStart(2, "0") : "01";
        docXml = docXml.replace(/(Số:\s*<\/w:t>.*?<w:t>)…(<\/w:t>)/s, (m, p1, p2) => p1 + escapeXml(voucherNo) + p2);

        // 2. Thành phố Hồ Chí Minh, ngày …  tháng … năm …… (cô lập trong Paragraph chứa Thành phố Hồ Chí Minh)
        docXml = docXml.replace(/<w:p\b[^>]*>(?:(?!<w:p\b)[\s\S])*?Thành phố Hồ Chí Minh[\s\S]*?<\/w:p>/, (pBlock) => {
            return pBlock
                .replace(/(ngày\s*<\/w:t>[\s\S]*?<w:t>)[…\.]+(<\/w:t>)/, "$1" + escapeXml(reqDate.dd) + "$2")
                .replace(/(tháng\s*<\/w:t>[\s\S]*?<w:t>)[…\.]+(<\/w:t>)/, "$1" + escapeXml(reqDate.mm) + "$2")
                .replace(/(năm\s*<\/w:t>[\s\S]*?<w:t>)[…\.]+(<\/w:t>)/, "$1" + escapeXml(reqDate.yyyy) + "$2");
        });

        // 3. Họ và tên người đề nghị: ………………………………………
        if (input.requesterName && input.requesterName.trim()) {
            docXml = docXml.replace(
                /(Họ và tên người đề nghị:\s*<\/w:t>.*?<w:t>)[…\.]{5,}(<\/w:t>)/s,
                (m, p1, p2) => p1 + escapeXml(input.requesterName.trim()) + p2
            );
        }

        // 4. Chức vụ: ……………………………………………
        const position = (input.position !== undefined ? input.position : "Nhân viên").trim();
        if (position) {
            docXml = docXml.replace(
                /(Chức vụ:\s*<\/w:t>.*?<w:t>)[…\.]{5,}(<\/w:t>)/s,
                (m, p1, p2) => p1 + escapeXml(position) + p2
            );
        }

        // 5. Bộ phận (Phòng/Ban): ………………………………
        const department = (input.department || "").trim();
        if (department) {
            docXml = docXml.replace(
                /(Bộ phận \(Phòng\/Ban\):\s*<\/w:t>.*?<w:t>)[…\.]{5,}(<\/w:t>)/s,
                (m, p1, p2) => p1 + escapeXml(department) + p2
            );
        }

        // 6. Số tiền thanh toán …………VNĐ (Bằng chữ: …………………………Việt Nam đồng)
        if (rawAmount > 0) {
            docXml = docXml.replace(
                /(Số tiền thanh toán\s*<\/w:t>.*?<w:t>)[…\.]{3,}(<\/w:t>)/s,
                (m, p1, p2) => p1 + escapeXml(formattedAmount) + " " + p2
            );
        }
        if (words && words.trim()) {
            docXml = docXml.replace(
                /(\(Bằng chữ:\s*<\/w:t>.*?<w:t>)[…\.]{5,}(<\/w:t>)/s,
                (m, p1, p2) => p1 + escapeXml(words.trim()) + " " + p2
            );
        }

        // 7. Lý do: …………………………………
        const reason = (input.reason || "").trim();
        if (reason) {
            docXml = docXml.replace(
                /(Lý do:\s*<\/w:t>.*?<w:t>)[…\.]{5,}(<\/w:t>)/s,
                (m, p1, p2) => p1 + escapeXml(reason) + p2
            );
        }

        // 8. Thời hạn thanh toán tạm ứng: ngày …tháng …năm … (cô lập trong Paragraph chứa Thời hạn thanh toán tạm ứng)
        docXml = docXml.replace(/<w:p\b[^>]*>(?:(?!<w:p\b)[\s\S])*?Thời hạn thanh toán tạm ứng[\s\S]*?<\/w:p>/, (pBlock) => {
            return pBlock
                .replace(/(ngày\s*<\/w:t>[\s\S]*?<w:t>)[…\.]+(<\/w:t>)/, "$1" + escapeXml(dueDate.dd) + "$2")
                .replace(/(tháng\s*<\/w:t>[\s\S]*?<w:t>)[…\.]+(<\/w:t>)/, "$1" + escapeXml(dueDate.mm) + "$2")
                .replace(/(năm\s*<\/w:t>[\s\S]*?<w:t>)[…\.]+(<\/w:t>)/, "$1" + escapeXml(dueDate.yyyy) + "$2");
        });

        // 9. Bảng chữ ký: Thêm chú thích (Ký, đóng dấu) & (Ký, ghi rõ họ tên), và điền tên Người đề nghị
        docXml = docXml.replace(/(<w:p\b[^>]*>(?:(?!<w:p\b)[\s\S])*?<w:t>GIÁM ĐỐC<\/w:t>[\s\S]*?<\/w:p>)/, (m) => {
            const sub = '<w:p><w:pPr><w:spacing w:after="120" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:i/><w:iCs/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:i/><w:iCs/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t>(Ký, đóng dấu)</w:t></w:r></w:p>';
            return m + sub;
        });

        docXml = docXml.replace(/(<w:p\b[^>]*>(?:(?!<w:p\b)[\s\S])*?<w:t>NGƯỜI ĐỀ NGHỊ<\/w:t>[\s\S]*?<\/w:p>)/, (m) => {
            const sub = '<w:p><w:pPr><w:spacing w:after="120" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:i/><w:iCs/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:i/><w:iCs/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t>(Ký, ghi rõ họ tên)</w:t></w:r></w:p>';
            return m + sub;
        });

        if (input.requesterName && input.requesterName.trim()) {
            docXml = docXml.replace(/(<w:p\b[^>]*w14:paraId="1D6118A1"[^>]*>)([\s\S]*?)(<\/w:p>)/, (m, pOpen, pBody, pClose) => {
                const textRun = '<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:b/><w:bCs/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr><w:t>' + escapeXml(input.requesterName.trim()) + '</w:t></w:r>';
                return pOpen + pBody + textRun + pClose;
            });
        }

        zip.file("word/document.xml", docXml);
        return await zip.generateAsync({ type: "nodebuffer" });
    }

    /**
     * Tạo file Word và tự động upload lên Google Drive vào thư mục GOOGLE_DRIVE_FOLDER_ID
     */
    async generateAndUploadToDrive(input: FillPaymentRequestDocInput): Promise<GeneratedDocResult> {
        const buffer = await this.generateWordDocument(input);
        const fileName = this.generateStandardFileName(input);

        let driveFileId: string | undefined;
        let webViewLink: string | undefined;

        try {
            const config = getGoogleConfig();
            const drive = getGoogleDriveClient();
            const fileMetadata: any = {
                name: fileName,
                mimeType: "application/vnd.google-apps.document"
            };
            if (config.driveFolderId) {
                fileMetadata.parents = [config.driveFolderId];
            }

            const media = {
                mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                body: Readable.from(buffer)
            };

            const res = await drive.files.create({
                requestBody: fileMetadata,
                media: media,
                fields: "id, name, webViewLink, webContentLink",
                supportsAllDrives: true
            });

            driveFileId = res.data.id || undefined;
            if (driveFileId) {
                webViewLink = `https://docs.google.com/document/d/${driveFileId}/view`;
                try {
                    await drive.permissions.create({
                        fileId: driveFileId,
                        requestBody: {
                            role: "writer",
                            type: "anyone"
                        },
                        supportsAllDrives: true
                    });
                } catch (permErr: any) {
                    console.warn("[PaymentRequestDocumentService] Quyền xem file Drive:", permErr?.message);
                }
            }
        } catch (driveErr: any) {
            console.error("[PaymentRequestDocumentService] Lỗi khi upload Drive:", driveErr?.message);
        }

        return {
            fileName,
            buffer,
            driveFileId,
            webViewLink
        };
    }
}
