import { Router } from "express";
import { ProjectTeamController } from "../controllers/ProjectTeam.Controller";

const router = Router();
const teamController = new ProjectTeamController();

router.get("/", teamController.getAll);
router.get("/:id", teamController.getOne);
router.get("/:id/members", teamController.getMembers);

router.post("/", teamController.create);
router.put("/:id", teamController.update);
router.delete("/:id", teamController.delete);
router.put("/:id/lead", teamController.changeLead);

// Member management
router.post("/:id/members", teamController.addMember);
router.patch("/members/:memberId", teamController.updateMember);
router.delete("/members/:memberId", teamController.removeMember);

export default router;
