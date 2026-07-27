import 'dotenv/config';
import "./entity/Enums";

import { AppDataSource } from "./data-source"
import express from "express"
import cors from "cors"
import cookieParser from "cookie-parser"
import passport from "./config/passport"

import authRoute from "./routes/Auth.Route"
import opportunityRoute from "./routes/Opportunity.Route"
import serviceRoute from "./routes/Service.Route"
import jobRoute from "./routes/Job.Route"
import contractRoute from "./routes/Contract.Route"
import quotationRoute from "./routes/Quotation.Route"
import paymentMilestoneRoute from "./routes/PaymentMilestone.Route"
import projectRoute from "./routes/Project.Route"
import taskRoute from "./routes/Task.Route"
import opportunityServiceRoute from "./routes/OpportunityService.Route"
import userRoute from "./routes/User.Route"
import projectTeamRoute from "./routes/ProjectTeam.Route"
import notificationRoute from "./routes/Notification.Route"
import dashboardRoute from "./routes/Dashboard.Route";
import customerRoute from "./routes/Customer.Route"
import vendorRoute from "./routes/Vendor.Route"
import referralPartnerRoute from "./routes/ReferralPartner.Route"
import debtRoute from "./routes/Debt.Route"
import contractAddendumRoute from "./routes/ContractAddendum.Route"
import jobCriteriaRoute from "./routes/JobCriteria.Route"
import taskReviewRoute from "./routes/TaskReview.Route"
import acceptanceRoute from "./routes/Acceptance.Route"
import cloudinaryRoute from "./routes/Cloudinary.Route"
import servicePackageRoute from "./routes/ServicePackage.Route"
import chatRoute from "./routes/Chat.Route"
import accountRoute from "./routes/Account.Route"
import profileRoute from "./routes/Profile.Route"
import { loggingMiddleware } from "./middlewares/Logging.Middleware";
import { authMiddleware } from "./middlewares/Auth.Middleware";
import { globalApiLimiter, writeRateLimitMiddleware } from "./middlewares/RateLimit.Middleware";
import { companyMemberMiddleware, tenantMiddleware } from "./middlewares/Tenant.Middleware";
import { installTenantRepositoryGuard } from "./helpers/TenantRepositoryGuard";
import { seedCompaniesAndDefaultMemberships } from "./helpers/CompanySeed.Helper";




const app = express()
app.set('trust proxy', 1)
const port = 3000
installTenantRepositoryGuard();

app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())
const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(",") : [];

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl requests)
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
}))
app.use(passport.initialize())

// Apply logging middleware globally
app.use(loggingMiddleware);

app.use("/:companySlug/api", globalApiLimiter)
app.use("/api", globalApiLimiter)

app.use("/:companySlug/api/auth", tenantMiddleware, authRoute)
app.use("/:companySlug/api/opportunities", tenantMiddleware, authMiddleware, writeRateLimitMiddleware, companyMemberMiddleware, opportunityRoute)
app.use("/:companySlug/api/services", tenantMiddleware, authMiddleware, writeRateLimitMiddleware, companyMemberMiddleware, serviceRoute)
app.use("/:companySlug/api/jobs", tenantMiddleware, authMiddleware, writeRateLimitMiddleware, companyMemberMiddleware, jobRoute)
app.use("/:companySlug/api/contracts", tenantMiddleware, authMiddleware, writeRateLimitMiddleware, companyMemberMiddleware, contractRoute)
app.use("/:companySlug/api/quotations", tenantMiddleware, authMiddleware, writeRateLimitMiddleware, companyMemberMiddleware, quotationRoute)
app.use("/:companySlug/api/payment-milestones", tenantMiddleware, authMiddleware, writeRateLimitMiddleware, companyMemberMiddleware, paymentMilestoneRoute)
app.use("/:companySlug/api/projects", tenantMiddleware, authMiddleware, writeRateLimitMiddleware, companyMemberMiddleware, projectRoute)
app.use("/:companySlug/api/tasks", tenantMiddleware, authMiddleware, writeRateLimitMiddleware, companyMemberMiddleware, taskRoute)
app.use("/:companySlug/api/opportunity-services", tenantMiddleware, authMiddleware, writeRateLimitMiddleware, companyMemberMiddleware, opportunityServiceRoute)
app.use("/:companySlug/api/users", tenantMiddleware, authMiddleware, writeRateLimitMiddleware, companyMemberMiddleware, userRoute)
app.use("/:companySlug/api/teams", tenantMiddleware, authMiddleware, writeRateLimitMiddleware, companyMemberMiddleware, projectTeamRoute)
app.use("/:companySlug/api/notifications", tenantMiddleware, authMiddleware, writeRateLimitMiddleware, companyMemberMiddleware, notificationRoute)
app.use("/:companySlug/api/dashboard", tenantMiddleware, authMiddleware, writeRateLimitMiddleware, companyMemberMiddleware, dashboardRoute);
app.use("/:companySlug/api/customers", tenantMiddleware, authMiddleware, writeRateLimitMiddleware, companyMemberMiddleware, customerRoute)
app.use("/:companySlug/api/vendors", tenantMiddleware, authMiddleware, writeRateLimitMiddleware, companyMemberMiddleware, vendorRoute)
app.use("/:companySlug/api/referral-partners", tenantMiddleware, authMiddleware, writeRateLimitMiddleware, companyMemberMiddleware, referralPartnerRoute)
app.use("/:companySlug/api/debts", tenantMiddleware, authMiddleware, writeRateLimitMiddleware, companyMemberMiddleware, debtRoute)
app.use("/:companySlug/api/contract-addendums", tenantMiddleware, authMiddleware, writeRateLimitMiddleware, companyMemberMiddleware, contractAddendumRoute)
app.use("/:companySlug/api/job-criteria", tenantMiddleware, authMiddleware, writeRateLimitMiddleware, companyMemberMiddleware, jobCriteriaRoute)
app.use("/:companySlug/api/task-reviews", tenantMiddleware, authMiddleware, writeRateLimitMiddleware, companyMemberMiddleware, taskReviewRoute)
app.use("/:companySlug/api/acceptance", tenantMiddleware, authMiddleware, writeRateLimitMiddleware, companyMemberMiddleware, acceptanceRoute)
app.use("/:companySlug/api/cloudinary", tenantMiddleware, authMiddleware, writeRateLimitMiddleware, companyMemberMiddleware, cloudinaryRoute)
app.use("/:companySlug/api/service-packages", tenantMiddleware, authMiddleware, writeRateLimitMiddleware, companyMemberMiddleware, servicePackageRoute)
app.use("/:companySlug/api/chat", tenantMiddleware, authMiddleware, writeRateLimitMiddleware, companyMemberMiddleware, chatRoute)
app.use("/:companySlug/api/accounts", tenantMiddleware, authMiddleware, writeRateLimitMiddleware, companyMemberMiddleware, accountRoute)
app.use("/:companySlug/api/me", tenantMiddleware, authMiddleware, writeRateLimitMiddleware, companyMemberMiddleware, profileRoute)

app.use("/api/auth", authRoute)
app.use("/api/opportunities", opportunityRoute)
app.use("/api/services", serviceRoute)
app.use("/api/jobs", jobRoute)
app.use("/api/contracts", contractRoute)
app.use("/api/quotations", quotationRoute)
app.use("/api/payment-milestones", paymentMilestoneRoute)
app.use("/api/projects", projectRoute)
app.use("/api/tasks", taskRoute)
app.use("/api/opportunity-services", opportunityServiceRoute)
app.use("/api/users", userRoute)
app.use("/api/teams", projectTeamRoute)
app.use("/api/notifications", notificationRoute)
app.use("/api/dashboard", dashboardRoute);
app.use("/api/customers", customerRoute)
app.use("/api/vendors", vendorRoute)
app.use("/api/referral-partners", referralPartnerRoute)
app.use("/api/debts", debtRoute)
app.use("/api/contract-addendums", contractAddendumRoute)
app.use("/api/job-criteria", jobCriteriaRoute)
app.use("/api/task-reviews", taskReviewRoute)
app.use("/api/acceptance", acceptanceRoute)
app.use("/api/cloudinary", cloudinaryRoute)
app.use("/api/service-packages", servicePackageRoute)
app.use("/api/chat", chatRoute)
app.use("/api/accounts", accountRoute)
app.use("/api/me", profileRoute)
app.get("/health", (req, res) => {
    res.status(200).send("OK");
});
app.head("/health", (req, res) => {
    res.status(200).end();
});

import { CronHelper } from "./helpers/Cron.Helper";
import { initSubscribers } from "./subscribers";


AppDataSource.initialize().then(async () => {
    await seedCompaniesAndDefaultMemberships();
    // Initialize Event Subscribers
    initSubscribers();

    app.listen(port, () => {
        console.log(`Server is running on ${port}`)
        CronHelper.init();
    })

}).catch(error => console.log(error))
