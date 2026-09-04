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
import { CronHelper } from "./helpers/Cron.Helper";
import { initSubscribers } from "./subscribers";




const app = express()
app.set('trust proxy', 1)
app.set('etag', false)
const port = 3000

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

app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
});

app.use("/api", globalApiLimiter)

app.use("/api/auth", authRoute)
app.use("/api/opportunities", authMiddleware, writeRateLimitMiddleware, opportunityRoute)
app.use("/api/services", authMiddleware, writeRateLimitMiddleware, serviceRoute)
app.use("/api/jobs", authMiddleware, writeRateLimitMiddleware, jobRoute)
app.use("/api/contracts", authMiddleware, writeRateLimitMiddleware, contractRoute)
app.use("/api/quotations", authMiddleware, writeRateLimitMiddleware, quotationRoute)
app.use("/api/payment-milestones", authMiddleware, writeRateLimitMiddleware, paymentMilestoneRoute)
app.use("/api/projects", authMiddleware, writeRateLimitMiddleware, projectRoute)
app.use("/api/tasks", authMiddleware, writeRateLimitMiddleware, taskRoute)
app.use("/api/opportunity-services", authMiddleware, writeRateLimitMiddleware, opportunityServiceRoute)
app.use("/api/users", authMiddleware, writeRateLimitMiddleware, userRoute)
app.use("/api/teams", authMiddleware, writeRateLimitMiddleware, projectTeamRoute)
app.use("/api/notifications", authMiddleware, writeRateLimitMiddleware, notificationRoute)
app.use("/api/dashboard", authMiddleware, writeRateLimitMiddleware, dashboardRoute);
app.use("/api/customers", authMiddleware, writeRateLimitMiddleware, customerRoute)
app.use("/api/vendors", authMiddleware, writeRateLimitMiddleware, vendorRoute)
app.use("/api/referral-partners", authMiddleware, writeRateLimitMiddleware, referralPartnerRoute)
app.use("/api/debts", authMiddleware, writeRateLimitMiddleware, debtRoute)
app.use("/api/contract-addendums", authMiddleware, writeRateLimitMiddleware, contractAddendumRoute)
app.use("/api/job-criteria", authMiddleware, writeRateLimitMiddleware, jobCriteriaRoute)
app.use("/api/task-reviews", authMiddleware, writeRateLimitMiddleware, taskReviewRoute)
app.use("/api/acceptance", authMiddleware, writeRateLimitMiddleware, acceptanceRoute)
app.use("/api/cloudinary", authMiddleware, writeRateLimitMiddleware, cloudinaryRoute)
app.use("/api/service-packages", authMiddleware, writeRateLimitMiddleware, servicePackageRoute)
app.use("/api/chat", authMiddleware, writeRateLimitMiddleware, chatRoute)
app.use("/api/accounts", authMiddleware, writeRateLimitMiddleware, accountRoute)
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

    app.listen(port, () => {
        console.log(`Server is running on ${port}`)
        CronHelper.init();
    })

}).catch(error => console.log(error))
