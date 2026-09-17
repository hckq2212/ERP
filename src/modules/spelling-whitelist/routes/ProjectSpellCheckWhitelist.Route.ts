import { Router } from "express";
import { ProjectSpellCheckWhitelistController } from "../controllers/ProjectSpellCheckWhitelist.Controller";

const router = Router({ mergeParams: true });
const controller = new ProjectSpellCheckWhitelistController();

router.get("/", controller.list);
router.post("/", controller.add);
router.delete("/:whitelistId", controller.remove);

export default router;
