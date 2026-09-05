import { Router } from "express";
import { AccountController } from "../controllers/Account.Controller";
import { roleMiddleware } from "../../../shared/middlewares/Role.Middleware";

const router = Router();
const accountController = new AccountController();

// All routes are restricted to ADMIN or BOD after the /api/accounts auth guard.
router.use(roleMiddleware(["ADMIN", "BOD"]));

router.get("/", accountController.index);
router.get("/:id", accountController.show);
router.put("/:id", accountController.update);
router.put("/:id/reset-password", accountController.resetPassword);
router.delete("/:id", accountController.delete);

export default router;
