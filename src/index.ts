import 'dotenv/config';
import "./shared/entities/Enums";

import { AppDataSource } from "./data-source"
import express from "express"
import cors from "cors"
import cookieParser from "cookie-parser"
import passport from "./shared/config/passport"

import authRoute from "./modules/auth/routes/Auth.Route"
import opportunityRoute from "./modules/opportunity/routes/Opportunity.Route"
import serviceRoute from "./modules/service/routes/Service.Route"
import jobRoute from "./modules/job/routes/Job.Route"
import contractRoute from "./modules/contract/routes/Contract.Route"
import quotationRoute from "./modules/quotation/routes/Quotation.Route"
import paymentMilestoneRoute from "./modules/payment-milestone/routes/PaymentMilestone.Route"
import projectRoute from "./modules/project/routes/Project.Route"
import taskRoute from "./modules/task/routes/Task.Route"
import opportunityServiceRoute from "./modules/opportunity-service/routes/OpportunityService.Route"
import userRoute from "./modules/user/routes/User.Route"
import projectTeamRoute from "./modules/project/routes/ProjectTeam.Route"
import notificationRoute from "./modules/notification/routes/Notification.Route"
import announcementRoute from "./modules/announcement/routes/Announcement.Route"
import dashboardRoute from "./modules/dashboard/routes/Dashboard.Route";
import customerRoute from "./modules/customer/routes/Customer.Route"
import vendorRoute from "./modules/vendor/routes/Vendor.Route"
import referralPartnerRoute from "./modules/referral-partner/routes/ReferralPartner.Route"
import debtRoute from "./modules/debt/routes/Debt.Route"
import paymentRequestRoute from "./modules/payment-request/routes/PaymentRequest.Route"
import contractAddendumRoute from "./modules/contract-addendum/routes/ContractAddendum.Route"
import jobCriteriaRoute from "./modules/job-criteria/routes/JobCriteria.Route"
import taskReviewRoute from "./modules/task/routes/TaskReview.Route"
import taskResultCheckRoute from "./modules/task/routes/TaskResultCheck.Route"
import acceptanceRoute from "./modules/acceptance/routes/Acceptance.Route"
import cloudinaryRoute from "./modules/cloudinary/routes/Cloudinary.Route"
import servicePackageRoute from "./modules/service-package/routes/ServicePackage.Route"
import chatRoute from "./modules/chat/routes/Chat.Route"
import accountRoute from "./modules/account/routes/Account.Route"
import profileRoute from "./modules/profile/routes/Profile.Route"
import spellingCheckRoute from "./modules/spelling-check/routes/SpellingCheck.Route"
import qcRoute from "./modules/qc/routes/Qc.Route"
import settingRoute from "./modules/setting/routes/Setting.Route"
import projectSpellCheckWhitelistRoute from "./modules/spelling-whitelist/routes/ProjectSpellCheckWhitelist.Route"
import { loggingMiddleware } from "./shared/middlewares/Logging.Middleware";
import { authMiddleware } from "./shared/middlewares/Auth.Middleware";
import { globalApiLimiter, writeRateLimitMiddleware } from "./shared/middlewares/RateLimit.Middleware";
import { idempotencyMiddleware } from "./shared/middlewares/Idempotency.Middleware";
import { CronHelper } from "./shared/helpers/Cron.Helper";
import { initSubscribers } from "./shared/subscribers";
import aiProviderRoute from "./modules/ai-provider/routes/AiProvider.Route"
import aiModelRoute from "./modules/ai-model/routes/AiModel.Route"
import assetRoute from "./modules/asset/routes/Asset.Route"
import videoGenerationRoute from "./modules/video-generation/routes/VideoGeneration.Route"
import aiElementRoute from "./modules/ai-element/routes/AiElement.Route"
import documentLibraryRoute from "./modules/document-library/routes/DocumentLibrary.Route"
import chatRoomRoute from "./modules/chat-room/routes/ChatRoom.Route"
import { createServer } from "http"
import { initSocket } from "./socket"
import aiDashboardRoute from "./modules/ai-dashboard/routes/AiDashboard.Route"
import paymentDashboardRoute from "./modules/payment-dashboard/routes/PaymentDashboard.Route"
import financeDocumentRoute from "./modules/finance-document/routes/FinanceDocument.Route"
import { DashboardCacheCoordinator } from "./modules/dashboard/services/DashboardCache.Coordinator";

const app = express()
app.set('trust proxy', 1)
app.set('etag', false)
const port = 3000
const httpServer = createServer(app)

// Mặc định 100kb là quá nhỏ cho nội dung trích xuất/AI format của tài liệu dài
app.use(express.json({ limit: "10mb" }))
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())
const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(",") : [];

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);

        if (
            allowedOrigins.includes(origin) ||
            origin.includes("/gdt-api/tax-payer") ||
            origin.endsWith(".vercel.app") ||
            origin.endsWith(".workers.dev") ||
            origin.endsWith(".onrender.com") ||
            /^http:\/\/localhost:\d+$/.test(origin)
        ) {
            callback(null, true);
        } else {
            callback(new Error("Not allowed by CORS"));
        }
    },
    credentials: true
}))
app.use(passport.initialize())

// Apply logging middleware globally
app.use(loggingMiddleware);

app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
});

app.use("/api", globalApiLimiter)

const protectedPipeline = [authMiddleware, writeRateLimitMiddleware, idempotencyMiddleware];

app.use("/api/auth", authRoute)
app.use("/api/opportunities", ...protectedPipeline, opportunityRoute)
app.use("/api/services", ...protectedPipeline, serviceRoute)
app.use("/api/jobs", ...protectedPipeline, jobRoute)
app.use("/api/contracts", ...protectedPipeline, contractRoute)
app.use("/api/quotations", ...protectedPipeline, quotationRoute)
app.use("/api/payment-milestones", ...protectedPipeline, paymentMilestoneRoute)
app.use("/api/projects", ...protectedPipeline, projectRoute)
app.use("/api/tasks", ...protectedPipeline, taskRoute)
app.use("/api/opportunity-services", ...protectedPipeline, opportunityServiceRoute)
app.use("/api/users", ...protectedPipeline, userRoute)
app.use("/api/teams", ...protectedPipeline, projectTeamRoute)
app.use("/api/notifications", ...protectedPipeline, notificationRoute)
app.use("/api/announcements", ...protectedPipeline, announcementRoute)
app.use("/api/dashboard", ...protectedPipeline, dashboardRoute);
app.use("/api/payment-dashboard", ...protectedPipeline, paymentDashboardRoute)
app.use("/api/finance-documents", ...protectedPipeline, financeDocumentRoute)
app.use("/api/customers", ...protectedPipeline, customerRoute)
app.use("/api/vendors", ...protectedPipeline, vendorRoute)
app.use("/api/referral-partners", ...protectedPipeline, referralPartnerRoute)
app.use("/api/debts", ...protectedPipeline, debtRoute)
app.use("/api/payment-requests", ...protectedPipeline, paymentRequestRoute)
app.use("/api/contract-addendums", ...protectedPipeline, contractAddendumRoute)
app.use("/api/job-criteria", ...protectedPipeline, jobCriteriaRoute)
app.use("/api/task-reviews", ...protectedPipeline, taskReviewRoute)
app.use("/api/task-result-checks", ...protectedPipeline, taskResultCheckRoute)
app.use("/api/acceptance", ...protectedPipeline, acceptanceRoute)
app.use("/api/cloudinary", ...protectedPipeline, cloudinaryRoute)
app.use("/api/service-packages", ...protectedPipeline, servicePackageRoute)
app.use("/api/chat", ...protectedPipeline, chatRoute)
app.use("/api/chat-rooms", ...protectedPipeline, chatRoomRoute)
app.use("/api/spelling-check", ...protectedPipeline, spellingCheckRoute)
app.use("/api/qc", ...protectedPipeline, qcRoute)
app.use("/api/settings", ...protectedPipeline, settingRoute)
app.use("/api/projects/:projectId/spelling-whitelist", ...protectedPipeline, projectSpellCheckWhitelistRoute)
app.use("/api/accounts", ...protectedPipeline, accountRoute)

app.use("/api/ai-providers", ...protectedPipeline, aiProviderRoute)
app.use("/api/ai-models", ...protectedPipeline, aiModelRoute)
app.use("/api/assets", ...protectedPipeline, assetRoute)
app.use("/api/video-generations", ...protectedPipeline, videoGenerationRoute)
app.use("/api/elements", ...protectedPipeline, aiElementRoute)
app.use("/api/document-library", ...protectedPipeline, documentLibraryRoute)
app.use("/api/ai-dashboard", ...protectedPipeline, aiDashboardRoute)

app.use("/api/me", profileRoute)

app.get("/health", (req, res) => {
    res.status(200).send("OK");
});
app.head("/health", (req, res) => {
    res.status(200).end();
});



AppDataSource.initialize().then(async () => {
    // Initialize Event Subscribers
    initSubscribers();

    initSocket(httpServer);

    httpServer.listen(port, () => {
        console.log(`Server is running on ${port}`)
        CronHelper.init();
    })

    const gracefulShutdown = async () => {
        try {
            await DashboardCacheCoordinator.flush();
        } catch (e) {
            console.error("[Shutdown] Error flushing DashboardCacheCoordinator:", e);
        }
        process.exit(0);
    };
    process.on("SIGTERM", gracefulShutdown);
    process.on("SIGINT", gracefulShutdown);

}).catch(error => console.log(error))
