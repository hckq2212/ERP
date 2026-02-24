import { Router } from "express";
import { TaskController } from "../controllers/Task.Controller";
import { authMiddleware } from "../middlewares/Auth.Middleware";
import multer from "multer";


const router = Router();
const taskController = new TaskController();

const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 25 * 1024 * 1024,
        files: 5
    }
});

router.get("/", authMiddleware, taskController.getAll);
router.get("/:id", authMiddleware, taskController.getOne);
router.post("/", authMiddleware, taskController.create);
router.post("/internal", authMiddleware, taskController.createInternal);
router.put("/:id", authMiddleware, taskController.update);
router.put("/:id/assign", authMiddleware, upload.array('files', 5), taskController.assign);
router.patch("/:id/submit-result", authMiddleware, upload.single('file'), taskController.submitResult);
router.delete("/:id", authMiddleware, taskController.delete);
router.post("/:id/pricing", authMiddleware, taskController.assessExtraTask);


export default router;
