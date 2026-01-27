import { AppDataSource } from "./data-source"
import express from "express"
import cors from "cors"

import authRoute from "./routes/Auth.Route"
import opportunityRoute from "./routes/Opportunity.Route"
import serviceRoute from "./routes/Service.Route"
import jobRoute from "./routes/Job.Route"

const app = express()
const port = 3000

app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(cors())

app.use("/api/auth", authRoute)
app.use("/api/opportunities", opportunityRoute)
app.use("/api/services", serviceRoute)
app.use("/api/jobs", jobRoute)

AppDataSource.initialize().then(async () => {

    app.listen(port, () => {
        console.log(`Server is running on ${port}`)
    })

}).catch(error => console.log(error))
