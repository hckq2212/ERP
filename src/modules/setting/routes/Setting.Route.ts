import { Router } from "express";
import { SettingController } from "../controllers/Setting.Controller";
import { roleMiddleware } from "../../../shared/middlewares/Role.Middleware";

const router = Router();
const controller = new SettingController();

router.get("/qc", roleMiddleware(["ADMIN"]), controller.getQc);
router.put("/qc", roleMiddleware(["ADMIN"]), controller.updateQc);

export default router;
