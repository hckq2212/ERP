import { Router } from "express";
import { ProjectController } from "../controllers/Project.Controller";
import { authMiddleware } from "../middlewares/Auth.Middleware";
import { validationMiddleware } from "../middlewares/Validation.Middleware";
import { AssignTeamDTO } from "../dto/Project.dto";
import { roleMiddleware } from "../middlewares/Role.Middleware";


const router = Router();
const projectController = new ProjectController();

router.get("/", authMiddleware, projectController.getAll);
router.get("/contract/:contractId", authMiddleware, projectController.getByContract);
router.get("/:id/monthly-work-template", authMiddleware, projectController.getMonthlyWorkTemplate);


router.post("/assign", authMiddleware, validationMiddleware(AssignTeamDTO), projectController.assign);
router.post("/:id/confirm", authMiddleware, projectController.confirm);
router.post("/:id/monthly-work-addendums", authMiddleware, projectController.createMonthlyWorkAddendum);
router.post(
    "/:id/google-sheet/retry",
    authMiddleware,
    roleMiddleware(["BOD", "ADMIN"]),
    projectController.retryGoogleSheet
);
router.post(
    "/:id/sync-service-jobs",
    authMiddleware,
    roleMiddleware(["ADMIN"]),
    projectController.syncServiceJobs
);
router.get("/:id", authMiddleware, projectController.getOne);
// router.post("/:id/start", authMiddleware, projectController.start);


export default router;
