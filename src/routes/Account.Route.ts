import { Router } from "express";
import { AccountController } from "../controllers/Account.Controller";
import { authMiddleware } from "../middlewares/Auth.Middleware";
import { roleMiddleware } from "../middlewares/Role.Middleware";

const router = Router();
const accountController = new AccountController();

// All routes are protected and restricted to ADMIN or BOD
router.use(authMiddleware);
router.use(roleMiddleware(["ADMIN", "BOD"]));

router.get("/", accountController.index);
router.get("/:id", accountController.show);
router.put("/:id", accountController.update);
router.delete("/:id", accountController.delete);

export default router;
