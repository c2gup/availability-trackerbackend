import { Router } from "express";
import { getWeekly, saveBatch, getTemplate } from "../controllers/availabilityController.js";
import { authenticate } from "../middleware/auth.js";

export const availabilityRoutes = Router();

availabilityRoutes.use(authenticate);
availabilityRoutes.get("/weekly", getWeekly);
availabilityRoutes.get("/template", getTemplate);
availabilityRoutes.post("/batch", saveBatch);
