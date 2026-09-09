import { Router } from "express";
import { ProjectController } from "../controllers/Project.Controller";
import { validationMiddleware } from "../../../shared/middlewares/Validation.Middleware";
import { AssignTeamDTO } from "../dto/Project.dto";
import { roleMiddleware } from "../../../shared/middlewares/Role.Middleware";


const router = Router();
const projectController = new ProjectController();

router.get("/", projectController.getAll);
router.get("/contract/:contractId", projectController.getByContract);
router.get("/my-projects", projectController.getMyProjects);
router.get("/:id/monthly-work-template", projectController.getMonthlyWorkTemplate);


router.post("/assign", validationMiddleware(AssignTeamDTO), projectController.assign);
router.post("/:id/confirm", projectController.confirm);
router.post("/:id/monthly-work-addendums", projectController.createMonthlyWorkAddendum);
router.post("/:id/service-addendums", projectController.createServiceAddendum);
router.get("/:id/product-descriptions", projectController.getProductDescriptions);
router.post("/:id/product-descriptions", projectController.createProductDescription);
router.put("/:id/product-descriptions/:submissionId", projectController.updateProductDescription);
router.post("/:id/product-descriptions/:submissionId/submit", projectController.submitProductDescription);
router.post(
    "/:id/product-descriptions/:submissionId/approve",
    roleMiddleware(["PM"]),
    projectController.approveProductDescription
);
router.post(
    "/:id/product-descriptions/:submissionId/reject",
    roleMiddleware(["PM"]),
    projectController.rejectProductDescription
);
// Google Sheet integration is temporarily disabled.
// router.post(
//     "/:id/google-sheet/retry",
//     authMiddleware,
//     roleMiddleware(["BOD", "ADMIN", "PM"]),
//     projectController.retryGoogleSheet
// );
router.post(
    "/:id/sync-service-jobs",
    roleMiddleware(["ADMIN", "PM"]),
    projectController.syncServiceJobs
);
router.get("/:id", projectController.getOne);
// router.post("/:id/start", projectController.start);


export default router;
