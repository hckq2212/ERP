import axios from "axios";

/**
 * Client for the standalone Vispeller spell-checking service (Python/FastAPI).
 * Vispeller runs as its own process (no Docker) - see /vispeller/README or
 * the deployment notes for how to start it (uvicorn / systemd / pm2).
 *
 * Configure the base URL via VISPELLER_API_URL (default http://127.0.0.1:8000).
 */

export interface VispellerErrorEntry {
    suggestions: string[];
    positions: { sheet: string; row: number; column: number }[];
    suspected_proper_noun: boolean;
}

export interface VispellerCheckResult {
    errors: Record<string, VispellerErrorEntry>;
}

export interface VispellerCheckOptions {
    lang?: "vi" | "en" | "both";
    whitelist?: string[];
    useDefaultWhitelist?: boolean;
    properNounThreshold?: number;
    timeoutMs?: number;
}

export interface VispellerReportMeta {
    title?: string;
    taskCode?: string;
    taskName?: string;
    checkedAt?: string;
}

export interface VispellerReportResult {
    /** Raw PDF bytes - never send this JSON-side, only the file itself. */
    pdf: Buffer;
    status: "CLEAN" | "HAS_ERRORS";
    errorCount: number;
}

// A Google Sheets link or a direct URL ending in .xlsx/.xlsm/.xls
const SPREADSHEET_URL_RE = /docs\.google\.com\/spreadsheets|\.xlsx?(?:$|[?#])|\.xlsm(?:$|[?#])/i;

export class VispellerService {
    private static get baseUrl(): string {
        return process.env.VISPELLER_API_URL || "http://127.0.0.1:8000";
    }

    /** Whether this URL is something Vispeller can actually check (spreadsheet). */
    static isSpreadsheetLink(url?: string | null): boolean {
        if (!url) return false;
        return SPREADSHEET_URL_RE.test(url);
    }

    /**
     * Calls POST /check-link on the Vispeller service.
     * Throws on network error / non-2xx response - callers decide how to
     * degrade (e.g. don't block task submission if the checker is down).
     */
    static async checkLink(link: string, options: VispellerCheckOptions = {}): Promise<VispellerCheckResult> {
        const {
            lang = "both",
            whitelist,
            useDefaultWhitelist = true,
            properNounThreshold = 3,
            // Checking a spreadsheet can be slow (download + dictionary lookups
            // per word), so give it a generous timeout.
            timeoutMs = 120_000,
        } = options;

        const response = await axios.post(
            `${this.baseUrl}/check-link`,
            {
                link,
                lang,
                whitelist,
                use_default_whitelist: useDefaultWhitelist,
                proper_noun_threshold: properNounThreshold,
            },
            { timeout: timeoutMs }
        );

        return response.data;
    }

    /**
     * Runs the same check as {@link checkLink}, but asks Vispeller to render
     * the result straight into a professional PDF report and returns the
     * raw bytes - the raw errors JSON never leaves the Vispeller process.
     *
     * Status/count are read back from response headers (the body is binary
     * PDF), so callers can decide whether to block a submission without
     * ever touching the raw error list.
     */
    static async checkLinkReport(
        link: string,
        meta: VispellerReportMeta = {},
        options: VispellerCheckOptions = {}
    ): Promise<VispellerReportResult> {
        const {
            lang = "both",
            whitelist,
            useDefaultWhitelist = true,
            properNounThreshold = 3,
            timeoutMs = 120_000,
        } = options;

        const response = await axios.post(
            `${this.baseUrl}/check-link/report`,
            {
                link,
                lang,
                whitelist,
                use_default_whitelist: useDefaultWhitelist,
                proper_noun_threshold: properNounThreshold,
                meta: {
                    title: meta.title,
                    task_code: meta.taskCode,
                    task_name: meta.taskName,
                    checked_at: meta.checkedAt,
                },
            },
            { timeout: timeoutMs, responseType: "arraybuffer" }
        );

        return {
            pdf: Buffer.from(response.data),
            status: (response.headers["x-spellcheck-status"] as "CLEAN" | "HAS_ERRORS") || "CLEAN",
            errorCount: Number(response.headers["x-spellcheck-error-count"] || 0),
        };
    }
}
