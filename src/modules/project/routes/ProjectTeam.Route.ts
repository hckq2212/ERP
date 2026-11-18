import { Router } from "express";
import { ProjectTeamController } from "../controllers/ProjectTeam.Controller";
import { roleMiddleware } from "../../../shared/middlewares/Role.Middleware";

const router = Router();
const teamController = new ProjectTeamController();

const teamManageRoles = roleMiddleware(["ADMIN", "BOD", "PM"]);

router.get("/", teamController.getAll);
router.get("/:id", teamController.getOne);
router.get("/:id/members", teamController.getMembers);

router.post("/", teamManageRoles, teamController.create);
router.put("/:id", teamManageRoles, teamController.update);
router.delete("/:id", roleMiddleware(["ADMIN", "BOD"]), teamController.delete);
router.put("/:id/lead", teamManageRoles, teamController.changeLead);

// Member management
router.post("/:id/members", teamManageRoles, teamController.addMember);
router.put("/:id/members/:userId/roles", teamManageRoles, teamController.updateMemberRoles);
router.patch("/members/:memberId", teamManageRoles, teamController.updateMember);
router.delete("/members/:memberId", teamManageRoles, teamController.removeMember);

export default router;
