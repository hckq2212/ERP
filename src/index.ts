import { AppDataSource } from "./data-source"
import express from "express"
import cors from "cors"

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

const app = express()
const port = 3000

app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(cors())

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

AppDataSource.initialize().then(async () => {

    app.listen(port, () => {
        console.log(`Server is running on ${port}`)
    })

}).catch(error => console.log(error))
