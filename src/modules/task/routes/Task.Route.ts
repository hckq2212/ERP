import { Router } from "express";
import { TaskController } from "../controllers/Task.Controller";
import multer from "multer";


const router = Router();
const taskController = new TaskController();

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, require("os").tmpdir()),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${file.originalname}`)
});
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 500 * 1024 * 1024,
        files: 1
    }
});

import { validationMiddleware } from "../../../shared/middlewares/Validation.Middleware";
import { BulkUnassignTasksDTO, CreateTaskDTO, TaskAssignmentDTO, UpdateTaskNicknameDTO } from "../dto/Task.dto";

router.get("/", taskController.getAll);
router.get("/:id", taskController.getOne);
router.post("/", validationMiddleware(CreateTaskDTO), taskController.create);
router.post("/internal", taskController.createInternal);
router.put("/bulk-assign", taskController.bulkAssign);
router.patch("/bulk-unassign", validationMiddleware(BulkUnassignTasksDTO), taskController.bulkUnassign);
router.patch("/:id/nickname", validationMiddleware(UpdateTaskNicknameDTO), taskController.updateNickname);
router.put("/:id", taskController.update);
router.put("/:id/assign", validationMiddleware(TaskAssignmentDTO), taskController.assign);
router.patch("/:id/submit-result", taskController.submitResult);
router.patch("/:id/submit-result-file", upload.single("file"), taskController.submitResultFile);
router.delete("/:id", taskController.delete);
router.patch("/:id/reassign", taskController.reassign);
router.post("/:id/pricing", taskController.assessExtraTask);
router.post('/:id/request-support', taskController.requestSupport);
router.post('/:id/respond-support', taskController.respondToSupport);
router.post('/:id/return-support', taskController.returnSupport);
router.post('/:id/request-return-support', taskController.requestReturnSupport);
router.post('/:id/assign-support-team', taskController.assignSupportTeam);
router.patch("/:id/rework", taskController.rework);
router.patch("/:id/customer-approve", taskController.approveByCustomer);
router.post("/:id/remind", taskController.sendReminder);

export default router;
