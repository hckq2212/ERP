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
    sheetTemplateId: string;
    driveFolderId: string;
}

const getEnv = (name: string): string | undefined => process.env[name]?.trim();

const requireEnv = (name: string): string => {
    const value = getEnv(name);
    if (!value) {
        throw new Error(`Missing required Google configuration: ${name}`);
    }
    return value;
};

const getMissingEnv = (names: string[]) => names.filter((name) => !getEnv(name));

export const getGoogleConfig = (): GoogleConfig => {
    const sheetTemplateId = requireEnv("GOOGLE_SHEET_TEMPLATE_ID");
    const driveFolderId = requireEnv("GOOGLE_DRIVE_FOLDER_ID");
    const oauthFields = [
        "GOOGLE_OAUTH_CLIENT_ID",
        "GOOGLE_OAUTH_CLIENT_SECRET",
        "GOOGLE_OAUTH_REFRESH_TOKEN"
    ];
    const serviceAccountFields = [
        "GOOGLE_SERVICE_ACCOUNT_EMAIL",
        "GOOGLE_PRIVATE_KEY"
    ];
    const missingOAuthFields = getMissingEnv(oauthFields);
    const hasOAuthConfig = missingOAuthFields.length < oauthFields.length;

    if (hasOAuthConfig) {
        if (missingOAuthFields.length) {
            throw new Error(`Missing required Google OAuth configuration: ${missingOAuthFields.join(", ")}`);
        }

        return {
            authType: "oauth",
            oauthClientId: requireEnv("GOOGLE_OAUTH_CLIENT_ID"),
            oauthClientSecret: requireEnv("GOOGLE_OAUTH_CLIENT_SECRET"),
            oauthRefreshToken: requireEnv("GOOGLE_OAUTH_REFRESH_TOKEN"),
            sheetTemplateId,
            driveFolderId
        };
    }

    const missingServiceAccountFields = getMissingEnv(serviceAccountFields);
    if (missingServiceAccountFields.length) {
        throw new Error(
            "Missing required Google configuration: provide GOOGLE_OAUTH_CLIENT_ID, " +
            "GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN or " +
            missingServiceAccountFields.join(", ")
        );
    }

    return {
        authType: "serviceAccount",
        serviceAccountEmail: requireEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
        privateKey: requireEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n"),
        sheetTemplateId,
        driveFolderId
    };
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
