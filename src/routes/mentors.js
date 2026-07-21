import { Router } from "express";
import { getProfile, updateProfile } from "../controllers/mentorController.js";
import { authenticate, requireRole } from "../middleware/auth.js";

export const mentorRoutes = Router();

mentorRoutes.use(authenticate);
mentorRoutes.use(requireRole("MENTOR"));

mentorRoutes.get("/me/profile", getProfile);
mentorRoutes.put("/me/profile", updateProfile);
