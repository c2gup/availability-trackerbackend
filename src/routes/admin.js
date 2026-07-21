import { Router } from "express";
import {
  listUsers,
  listMentors,
  createUser,
  getAvailabilityForUser,
  getOverlappingSlots,
  scheduleMeeting,
  updateAdminUser,
  updateAdminMentor,
  getRecommendations,
} from "../controllers/adminController.js";
import { authenticate, requireRole } from "../middleware/auth.js";

export const adminRoutes = Router();

adminRoutes.use(authenticate);
adminRoutes.use(requireRole("ADMIN"));

adminRoutes.get("/users", listUsers);
adminRoutes.get("/mentors", listMentors);
adminRoutes.put("/users/:id", updateAdminUser);
adminRoutes.put("/mentors/:id", updateAdminMentor);
adminRoutes.get("/recommendations", getRecommendations);
adminRoutes.post("/create-user", createUser);
adminRoutes.get("/availability/:userId", getAvailabilityForUser);
adminRoutes.get("/availability/:userId/overlap", getOverlappingSlots);
adminRoutes.post("/meetings", scheduleMeeting);
