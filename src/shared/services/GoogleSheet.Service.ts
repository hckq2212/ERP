import {
    getGoogleConfig,
    getGoogleDriveClient,
    getGoogleSheetsClient
} from "../config/google";
import { readMoneyToWords } from "../utils/numberToWordsVi";

export interface CreateGoogleSheetInput {
    name: string;
    customerName?: string;
}

export interface GoogleSheetResult {
    spreadsheetId: string;
    spreadsheetUrl: string;
}

export interface PaymentRequestSheetRow {
    stt?: number | string;
    requesterName: string;
    requestDate: string;           // DD/MM/YYYY
    position?: string;
    department?: string;
    amount: number | string;
    amountInWords?: string;
    reason: string;
    dueDate: string;               // DD/MM/YYYY
    linkWord01?: string;
    linkWord02?: string;
    linkWord03?: string;
    generateWordStatus?: string;
    proofBillUrl?: string;
}


const REQUIRED_SHEETS = [
    "Timeline on air",
    "Các nội dung video",
    "Talent",
    "Tư liệu",
    "Báo cáo tháng",
    "CALLSHEET"
];

export class GoogleSheetService {
    async createFromTemplate(input: CreateGoogleSheetInput): Promise<GoogleSheetResult> {
        const config = getGoogleConfig();
        const drive = getGoogleDriveClient();

        const copyResponse = await drive.files.copy({
            fileId: config.sheetTemplateId,
            supportsAllDrives: true,
            requestBody: {
                name: input.name,
                parents: [config.driveFolderId]
            },
            fields: "id,webViewLink"
        });

        const spreadsheetId = copyResponse.data.id;
        if (!spreadsheetId) {
            throw new Error("Google Drive did not return an ID for the copied spreadsheet");
        }

        try {
            const sheets = getGoogleSheetsClient();
            const spreadsheet = await sheets.spreadsheets.get({
                spreadsheetId,
                fields: "spreadsheetId,sheets.properties.title"
            });

            const sheetTitles = new Set(
                spreadsheet.data.sheets
                    ?.map(sheet => sheet.properties?.title)
                    .filter((title): title is string => Boolean(title))
            );
            const missingSheets = REQUIRED_SHEETS.filter(title => !sheetTitles.has(title));
            if (missingSheets.length > 0) {
                throw new Error(`Google Sheet template is missing tabs: ${missingSheets.join(", ")}`);
            }

            const customerLabel = input.customerName?.trim()
                ? `Khách hàng: ${input.customerName.trim()}`
                : "Khách hàng:";

            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId,
                requestBody: {
                    valueInputOption: "RAW",
                    data: [
                        {
                            range: "'Tư liệu'!A2",
                            values: [[customerLabel]]
                        },
                        {
                            range: "'Báo cáo tháng'!A2",
                            values: [[customerLabel]]
                        }
                    ]
                }
            });
        } catch (error) {
            try {
                await drive.files.delete({
                    fileId: spreadsheetId,
                    supportsAllDrives: true
                });
            } catch (cleanupError: any) {
                console.error(
                    `[GoogleSheetService] Failed to clean up copied file ${spreadsheetId}:`,
                    cleanupError?.message
                );
            }
            throw error;
        }

        return {
            spreadsheetId,
            spreadsheetUrl: copyResponse.data.webViewLink
                || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
        };
    }

    async appendPaymentRequestRow(
        input: PaymentRequestSheetRow,
        customSpreadsheetId?: string,
        customTabName?: string
    ): Promise<{ updatedRange: string; spreadsheetUrl: string; rowIndex: number }> {
        const config = getGoogleConfig();
        const spreadsheetId = customSpreadsheetId || config.paymentRequestSpreadsheetId;
        const tabName = customTabName || config.paymentRequestSheetTab || "TH_GIẤY ĐỀ NGHỊ THANH TOÁN";
        const sheets = getGoogleSheetsClient();

        // 1. Tính STT tự động nếu chưa có (dựa vào cột B - Họ tên người đề nghị)
        let autoStt = input.stt;
        let nextRowIndex = 2;
        try {
            const currentRowsRes = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: `'${tabName}'!A:B`
            });
            const values = currentRowsRes.data.values || [];
            let filledCount = 0;
            let foundEmptyIndex = -1;
            for (let i = 1; i < values.length; i++) {
                const bVal = values[i]?.[1];
                const aVal = values[i]?.[0];
                if ((bVal && String(bVal).trim()) || (aVal && String(aVal).trim())) {
                    filledCount++;
                } else if (foundEmptyIndex === -1) {
                    foundEmptyIndex = i + 1;
                }
            }
            nextRowIndex = foundEmptyIndex !== -1 ? foundEmptyIndex : (values.length + 1);
            if (!autoStt) {
                autoStt = String(filledCount + 1).padStart(2, "0");
            } else {
                autoStt = String(autoStt).padStart(2, "0");
            }
        } catch {
            if (!autoStt) autoStt = "01";
        }

        // 2. Format số tiền chuẩn Getvini dấu chấm (264.000)
        const numericAmount = Math.round(Number(String(input.amount).replace(/\D/g, "")) || 0);
        const formattedAmount = numericAmount > 0 ? numericAmount.toLocaleString("vi-VN") : String(input.amount || "0");
        const amountWords = input.amountInWords || readMoneyToWords(numericAmount, "");

        // 3. Format minh chứng bill dạng hyperlink nếu có link
        let billCell = "⬆ TẢI BILL";
        if (input.proofBillUrl && input.proofBillUrl.trim()) {
            if (input.proofBillUrl.startsWith("http")) {
                billCell = `=HYPERLINK("${input.proofBillUrl.trim()}", "⬆ TẢI BILL")`;
            } else {
                billCell = input.proofBillUrl.trim();
            }
        }

        // Tuyệt đối không ghi đè cột A (STT) vì ô A2 đã có sẵn ARRAYFORMULA tự sinh số thứ tự
        const rowValues = [
            input.requesterName || "",
            input.requestDate || "",
            input.position || "Nhân viên",
            input.department || "Dự án",
            formattedAmount,
            amountWords,
            input.reason || "",
            input.dueDate || "",
            input.linkWord01 || "",
            input.linkWord02 || "",
            input.linkWord03 || "",
            false,
            billCell
        ];

        try {
            // Thử cập nhật toàn bộ dòng từ cột B đến N
            const updateRes = await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `'${tabName}'!B${nextRowIndex}:N${nextRowIndex}`,
                valueInputOption: "USER_ENTERED",
                requestBody: {
                    values: [rowValues]
                }
            });

            return {
                updatedRange: updateRes.data.updatedRange || `'${tabName}'!B${nextRowIndex}:N${nextRowIndex}`,
                spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
                rowIndex: nextRowIndex
            };
        } catch (err: any) {
            console.log(err)
            if (String(err?.message || "").includes("protected cell") || String(err?.cause?.message || "").includes("protected cell")) {
                await sheets.spreadsheets.values.update({
                    spreadsheetId,
                    range: `'${tabName}'!B${nextRowIndex}:I${nextRowIndex}`,
                    valueInputOption: "USER_ENTERED",
                    requestBody: {
                        values: [rowValues.slice(0, 8)]
                    }
                });
                await sheets.spreadsheets.values.update({
                    spreadsheetId,
                    range: `'${tabName}'!M${nextRowIndex}:N${nextRowIndex}`,
                    valueInputOption: "USER_ENTERED",
                    requestBody: {
                        values: [rowValues.slice(11)]
                    }
                });
                return {
                    updatedRange: `'${tabName}'!B${nextRowIndex}:N${nextRowIndex}`,
                    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
                    rowIndex: nextRowIndex
                };
            }
            throw err;
        }
    }
}

