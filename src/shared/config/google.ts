import * as fs from "fs";
import * as path from "path";
import { google } from "googleapis";

const GOOGLE_SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets"
];

export interface GoogleConfig {
    authType: "oauth" | "serviceAccount";
    oauthClientId?: string;
    oauthClientSecret?: string;
    oauthRefreshToken?: string;
    serviceAccountEmail?: string;
    privateKey?: string;
    keyFilePath?: string;
    sheetTemplateId?: string;
    driveFolderId: string;
    paymentRequestSpreadsheetId: string;
    paymentRequestSheetTab: string;
}

const getEnv = (name: string): string | undefined => process.env[name]?.trim();

const findServiceAccountKeyFile = (): { filePath: string; clientEmail: string; privateKey: string } | null => {
    const candidates = [
        getEnv("GOOGLE_KEY_FILE"),
        "service-account.json"
    ].filter(Boolean) as string[];

    const searchDirs = [
        process.cwd(),
        path.resolve(__dirname, "../../.."),
        path.resolve(__dirname, "../../../..")
    ];

    for (const filename of candidates) {
        for (const dir of searchDirs) {
            const fullPath = path.isAbsolute(filename) ? filename : path.resolve(dir, filename);
            if (fs.existsSync(fullPath)) {
                try {
                    const raw = fs.readFileSync(fullPath, "utf8");
                    const parsed = JSON.parse(raw);
                    if (parsed.client_email && parsed.private_key) {
                        return {
                            filePath: fullPath,
                            clientEmail: parsed.client_email,
                            privateKey: parsed.private_key
                        };
                    }
                } catch {
                    // Tiếp tục tìm file khác nếu file json lỗi
                }
            }
        }
    }
    return null;
};

export const getGoogleConfig = (): GoogleConfig => {
    const paymentRequestSpreadsheetId =
        getEnv("GOOGLE_PAYMENT_REQUEST_SPREADSHEET_ID") ||
        "1pmBp_yV1FJTKQpAM4WYMovrBCUugRN7kReJsJfjKHjY";
    const paymentRequestSheetTab =
        getEnv("GOOGLE_PAYMENT_REQUEST_SHEET_TAB") ||
        "TH_GIẤY ĐỀ NGHỊ THANH TOÁN";

    const sheetTemplateId = getEnv("GOOGLE_SHEET_TEMPLATE_ID") || paymentRequestSpreadsheetId;
    const driveFolderId = getEnv("GOOGLE_DRIVE_FOLDER_ID") || "";

    const keyFileResult = findServiceAccountKeyFile();

    if (keyFileResult) {
        return {
            authType: "serviceAccount",
            serviceAccountEmail: keyFileResult.clientEmail,
            privateKey: keyFileResult.privateKey.replace(/\\n/g, "\n"),
            keyFilePath: keyFileResult.filePath,
            sheetTemplateId,
            driveFolderId,
            paymentRequestSpreadsheetId,
            paymentRequestSheetTab
        };
    }

    const oauthFields = [
        "GOOGLE_OAUTH_CLIENT_ID",
        "GOOGLE_OAUTH_CLIENT_SECRET",
        "GOOGLE_OAUTH_REFRESH_TOKEN"
    ];
    const missingOAuth = oauthFields.filter((f) => !getEnv(f));
    if (missingOAuth.length === 0) {
        return {
            authType: "oauth",
            oauthClientId: getEnv("GOOGLE_OAUTH_CLIENT_ID")!,
            oauthClientSecret: getEnv("GOOGLE_OAUTH_CLIENT_SECRET")!,
            oauthRefreshToken: getEnv("GOOGLE_OAUTH_REFRESH_TOKEN")!,
            sheetTemplateId,
            driveFolderId,
            paymentRequestSpreadsheetId,
            paymentRequestSheetTab
        };
    }

    const email = getEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
    const pkey = getEnv("GOOGLE_PRIVATE_KEY");
    if (email && pkey) {
        return {
            authType: "serviceAccount",
            serviceAccountEmail: email,
            privateKey: pkey.replace(/\\n/g, "\n"),
            sheetTemplateId,
            driveFolderId,
            paymentRequestSpreadsheetId,
            paymentRequestSheetTab
        };
    }

    throw new Error(
        "Missing required Google configuration: Không tìm thấy file service account json hoặc biến GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY"
    );
};

const createGoogleAuth = () => {
    const config = getGoogleConfig();

    if (config.authType === "oauth") {
        const oauth2Client = new google.auth.OAuth2(
            config.oauthClientId,
            config.oauthClientSecret
        );

        oauth2Client.setCredentials({
            refresh_token: config.oauthRefreshToken
        });

        return oauth2Client;
    }

    if (config.keyFilePath && fs.existsSync(config.keyFilePath)) {
        return new google.auth.GoogleAuth({
            keyFile: config.keyFilePath,
            scopes: GOOGLE_SCOPES
        });
    }

    return new google.auth.GoogleAuth({
        credentials: {
            client_email: config.serviceAccountEmail,
            private_key: config.privateKey
        },
        scopes: GOOGLE_SCOPES
    });
};


let googleAuth: ReturnType<typeof createGoogleAuth> | null = null;

export const getGoogleAuth = () => {
    if (!googleAuth) {
        googleAuth = createGoogleAuth();
    }

    return googleAuth;
};

export const getGoogleDriveClient = () => google.drive({
    version: "v3",
    auth: getGoogleAuth()
});

export const getGoogleSheetsClient = () => google.sheets({
    version: "v4",
    auth: getGoogleAuth()
});
