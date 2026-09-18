import { Router } from "express"
import { AnnouncementController } from "../controllers/Announcement.Controller"
import { roleMiddleware } from "../../../shared/middlewares/Role.Middleware"
import { validationMiddleware } from "../../../shared/middlewares/Validation.Middleware"
import { CreateAnnouncementDTO, UpdateAnnouncementDTO } from "../dto/Announcement.dto"

const router = Router()
const announcementController = new AnnouncementController()

const MANAGE_ROLES = ["BOD", "ADMIN", "PM"]

router.get("/", announcementController.getAll)
router.put("/:id/read", announcementController.markAsRead)
router.get("/:id", announcementController.getOne)
router.post("/", roleMiddleware(MANAGE_ROLES), validationMiddleware(CreateAnnouncementDTO), announcementController.create)
router.put("/:id", roleMiddleware(MANAGE_ROLES), validationMiddleware(UpdateAnnouncementDTO), announcementController.update)
router.delete("/:id", roleMiddleware(MANAGE_ROLES), announcementController.delete)

export default router
