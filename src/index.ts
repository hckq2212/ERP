import "dotenv/config";
import "./shared/entities/Enums";

import cors from "cors";
import cookieParser from "cookie-parser";
import express from "express";
import { createServer } from "http";
import { AppDataSource } from "./data-source";
import passport from "./shared/config/passport";
import { CronHelper } from "./shared/helpers/Cron.Helper";
import { authMiddleware } from "./shared/middlewares/Auth.Middleware";
import { loggingMiddleware } from "./shared/middlewares/Logging.Middleware";
import { globalApiLimiter, writeRateLimitMiddleware } from "./shared/middlewares/RateLimit.Middleware";
import { initSubscribers } from "./shared/subscribers";
import { initSocket } from "./socket";
import acceptanceRoute from "./modules/acceptance/routes/Acceptance.Route";
import accountRoute from "./modules/account/routes/Account.Route";
import aiElementRoute from "./modules/ai-element/routes/AiElement.Route";
import aiModelRoute from "./modules/ai-model/routes/AiModel.Route";
import aiProviderRoute from "./modules/ai-provider/routes/AiProvider.Route";
import announcementRoute from "./modules/announcement/routes/Announcement.Route";
import assetRoute from "./modules/asset/routes/Asset.Route";
import authRoute from "./modules/auth/routes/Auth.Route";
import chatRoute from "./modules/chat/routes/Chat.Route";
import chatRoomRoute from "./modules/chat-room/routes/ChatRoom.Route";
import cloudinaryRoute from "./modules/cloudinary/routes/Cloudinary.Route";
import contractAddendumRoute from "./modules/contract-addendum/routes/ContractAddendum.Route";
import contractRoute from "./modules/contract/routes/Contract.Route";
import customerRoute from "./modules/customer/routes/Customer.Route";
import dashboardRoute from "./modules/dashboard/routes/Dashboard.Route";
import debtRoute from "./modules/debt/routes/Debt.Route";
import documentLibraryRoute from "./modules/document-library/routes/DocumentLibrary.Route";
import jobCriteriaRoute from "./modules/job-criteria/routes/JobCriteria.Route";
import jobRoute from "./modules/job/routes/Job.Route";
import notificationRoute from "./modules/notification/routes/Notification.Route";
import opportunityServiceRoute from "./modules/opportunity-service/routes/OpportunityService.Route";
import opportunityRoute from "./modules/opportunity/routes/Opportunity.Route";
import paymentMilestoneRoute from "./modules/payment-milestone/routes/PaymentMilestone.Route";
import profileRoute from "./modules/profile/routes/Profile.Route";
import projectRoute from "./modules/project/routes/Project.Route";
import projectTeamRoute from "./modules/project/routes/ProjectTeam.Route";
import qcRoute from "./modules/qc/routes/Qc.Route";
import quotationRoute from "./modules/quotation/routes/Quotation.Route";
import referralPartnerRoute from "./modules/referral-partner/routes/ReferralPartner.Route";
import servicePackageRoute from "./modules/service-package/routes/ServicePackage.Route";
import serviceRoute from "./modules/service/routes/Service.Route";
import settingRoute from "./modules/setting/routes/Setting.Route";
import spellingCheckRoute from "./modules/spelling-check/routes/SpellingCheck.Route";
import projectSpellCheckWhitelistRoute from "./modules/spelling-whitelist/routes/ProjectSpellCheckWhitelist.Route";
import taskResultCheckRoute from "./modules/task/routes/TaskResultCheck.Route";
import taskReviewRoute from "./modules/task/routes/TaskReview.Route";
import taskRoute from "./modules/task/routes/Task.Route";
import userRoute from "./modules/user/routes/User.Route";
import vendorRoute from "./modules/vendor/routes/Vendor.Route";
import videoGenerationRoute from "./modules/video-generation/routes/VideoGeneration.Route";

const app = express();
app.set("trust proxy", 1);
app.set("etag", false);
const port = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(",") : [];
app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);

        if (
            allowedOrigins.includes(origin) ||
            origin.endsWith(".vercel.app") ||
            origin.endsWith(".onrender.com") ||
            /^http:\/\/localhost:\d+$/.test(origin)
        ) {
            callback(null, true);
        } else {
            callback(new Error("Not allowed by CORS"));
        }
    },
    credentials: true
}));

app.use(passport.initialize());
app.use(loggingMiddleware);

app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
});

app.use("/api", globalApiLimiter);
app.use("/api/auth", authRoute);
app.use("/api/opportunities", authMiddleware, writeRateLimitMiddleware, opportunityRoute);
app.use("/api/services", authMiddleware, writeRateLimitMiddleware, serviceRoute);
app.use("/api/jobs", authMiddleware, writeRateLimitMiddleware, jobRoute);
app.use("/api/contracts", authMiddleware, writeRateLimitMiddleware, contractRoute);
app.use("/api/quotations", authMiddleware, writeRateLimitMiddleware, quotationRoute);
app.use("/api/payment-milestones", authMiddleware, writeRateLimitMiddleware, paymentMilestoneRoute);
app.use("/api/projects", authMiddleware, writeRateLimitMiddleware, projectRoute);
app.use("/api/tasks", authMiddleware, writeRateLimitMiddleware, taskRoute);
app.use("/api/opportunity-services", authMiddleware, writeRateLimitMiddleware, opportunityServiceRoute);
app.use("/api/users", authMiddleware, writeRateLimitMiddleware, userRoute);
app.use("/api/teams", authMiddleware, writeRateLimitMiddleware, projectTeamRoute);
app.use("/api/notifications", authMiddleware, writeRateLimitMiddleware, notificationRoute);
app.use("/api/announcements", authMiddleware, writeRateLimitMiddleware, announcementRoute);
app.use("/api/dashboard", authMiddleware, writeRateLimitMiddleware, dashboardRoute);
app.use("/api/customers", authMiddleware, writeRateLimitMiddleware, customerRoute);
app.use("/api/vendors", authMiddleware, writeRateLimitMiddleware, vendorRoute);
app.use("/api/referral-partners", authMiddleware, writeRateLimitMiddleware, referralPartnerRoute);
app.use("/api/debts", authMiddleware, writeRateLimitMiddleware, debtRoute);
app.use("/api/contract-addendums", authMiddleware, writeRateLimitMiddleware, contractAddendumRoute);
app.use("/api/job-criteria", authMiddleware, writeRateLimitMiddleware, jobCriteriaRoute);
app.use("/api/task-reviews", authMiddleware, writeRateLimitMiddleware, taskReviewRoute);
app.use("/api/task-result-checks", authMiddleware, writeRateLimitMiddleware, taskResultCheckRoute);
app.use("/api/acceptance", authMiddleware, writeRateLimitMiddleware, acceptanceRoute);
app.use("/api/cloudinary", authMiddleware, writeRateLimitMiddleware, cloudinaryRoute);
app.use("/api/service-packages", authMiddleware, writeRateLimitMiddleware, servicePackageRoute);
app.use("/api/chat", authMiddleware, writeRateLimitMiddleware, chatRoute);
app.use("/api/chat-rooms", authMiddleware, writeRateLimitMiddleware, chatRoomRoute);
app.use("/api/spelling-check", authMiddleware, writeRateLimitMiddleware, spellingCheckRoute);
app.use("/api/qc", authMiddleware, writeRateLimitMiddleware, qcRoute);
app.use("/api/settings", authMiddleware, writeRateLimitMiddleware, settingRoute);
app.use("/api/projects/:projectId/spelling-whitelist", authMiddleware, writeRateLimitMiddleware, projectSpellCheckWhitelistRoute);
app.use("/api/accounts", authMiddleware, writeRateLimitMiddleware, accountRoute);
app.use("/api/ai-providers", authMiddleware, writeRateLimitMiddleware, aiProviderRoute);
app.use("/api/ai-models", authMiddleware, writeRateLimitMiddleware, aiModelRoute);
app.use("/api/assets", authMiddleware, writeRateLimitMiddleware, assetRoute);
app.use("/api/video-generations", authMiddleware, writeRateLimitMiddleware, videoGenerationRoute);
app.use("/api/elements", authMiddleware, writeRateLimitMiddleware, aiElementRoute);
app.use("/api/document-library", authMiddleware, writeRateLimitMiddleware, documentLibraryRoute);
app.use("/api/me", profileRoute);

app.get("/health", (_req, res) => {
    res.status(200).send("OK");
});
app.head("/health", (_req, res) => {
    res.status(200).end();
});

AppDataSource.initialize().then(async () => {
    initSubscribers();

    const httpServer = createServer(app);
    initSocket(httpServer);

    httpServer.listen(port, () => {
        console.log(`Server is running on ${port}`);
        CronHelper.init();
    });
}).catch(error => console.log(error));
