import { Router } from "express";
import { UserController } from "../controllers/User.Controller";
import { authMiddleware } from "../middlewares/Auth.Middleware";
import { roleMiddleware } from "../middlewares/Role.Middleware";

const router = Router();
const userController = new UserController();

// All user routes protected by authMiddleware
router.use(authMiddleware);

router.get("/", userController.getAll);
router.get("/:id", userController.getOne);

// Only BOD and ADMIN can manage users (Create, Update, Delete)
router.post("/", roleMiddleware(["BOD", "ADMIN"]), userController.create);
router.put("/:id", roleMiddleware(["BOD", "ADMIN"]), userController.update);
router.delete("/:id", roleMiddleware(["BOD", "ADMIN"]), userController.delete);

export default router;
