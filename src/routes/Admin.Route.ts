import { Router } from "express";
import { AdminController } from "../controllers/Admin.Controller";
import { authMiddleware } from "../middlewares/Auth.Middleware";
import { roleMiddleware } from "../middlewares/Role.Middleware";

const router = Router();
const adminController = new AdminController();

router.use(authMiddleware);
router.use(roleMiddleware(["ADMIN"]));

router.get("/me", adminController.me);
router.get("/entities", adminController.entities);
router.get("/entities/:entityKey/schema", adminController.schema);
router.get("/entities/:entityKey/records", adminController.listRecords);
router.get("/entities/:entityKey/records/:id", adminController.getRecord);
router.post("/entities/:entityKey/records", adminController.createRecord);
router.patch("/entities/:entityKey/records/:id", adminController.updateRecord);
router.delete("/entities/:entityKey/records/:id", adminController.deleteRecord);
router.post("/accounts/:id/reset-password", adminController.resetPassword);

export default router;
