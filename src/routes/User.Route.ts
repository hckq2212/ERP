import { Router } from "express";
import { UserController } from "../controllers/User.Controller";
import { authMiddleware } from "../middlewares/Auth.Middleware";

const router = Router();
const userController = new UserController();

// All user routes protected by authMiddleware
router.use(authMiddleware);

router.get("/", userController.getAll);
router.get("/:id", userController.getOne);
router.post("/", userController.create);
router.put("/:id", userController.update);
router.delete("/:id", userController.delete);

export default router;
