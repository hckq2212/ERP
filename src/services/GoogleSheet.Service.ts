import {
    getGoogleConfig,
    getGoogleDriveClient,
    getGoogleSheetsClient
} from "../config/google";

export interface CreateGoogleSheetInput {
    name: string;
    customerName?: string;
}

export interface GoogleSheetResult {
    spreadsheetId: string;
    spreadsheetUrl: string;
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
}
