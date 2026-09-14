import { Router } from "express";
import { AiProviderController } from "../controllers/AiProvider.Controller";

const router = Router();
const aiProviderController = new AiProviderController();

router.get("/", aiProviderController.getAll);
router.get("/:id", aiProviderController.getOne);

export default router;