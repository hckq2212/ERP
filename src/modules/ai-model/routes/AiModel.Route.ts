import { Router } from "express";
import { AiModelController } from "../controllers/AiModel.Controller";
import { roleMiddleware } from "../../../shared/middlewares/Role.Middleware";

const router = Router();
const aiModelController = new AiModelController();

router.get("/", aiModelController.getAll);
router.get("/provider/:providerCode", aiModelController.getByProvider);
router.get("/:id", aiModelController.getOne);

router.post("/", roleMiddleware(["ADMIN"]), aiModelController.create);
router.patch("/:id", roleMiddleware(["ADMIN"]), aiModelController.update);
router.delete("/:id", roleMiddleware(["ADMIN"]), aiModelController.delete);

export default router;