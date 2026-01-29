import { Router } from "express";
import { ProjectTeamController } from "../controllers/ProjectTeam.Controller";

const router = Router();
const teamController = new ProjectTeamController();

router.get("/", teamController.getAll);
router.get("/:id", teamController.getOne);
router.post("/", teamController.create);
router.put("/:id", teamController.update);
router.delete("/:id", teamController.delete);

// Member management
router.post("/:id/members", teamController.addMember);
router.delete("/members/:memberId", teamController.removeMember);

export default router;
