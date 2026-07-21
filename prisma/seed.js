import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const password = await bcrypt.hash("Test@12345", 10);


  await prisma.user.upsert({
    where: { email: "admin@mentorque.com" },
    update: {
      name: "Admin",
      role: "ADMIN",
      timezone: "Asia/Kolkata",
      tags: ["Admin"],
      description: "Platform Administrator",
    },
    create: {
      name: "Admin",
      email: "admin@mentorque.com",
      password,
      role: "ADMIN",
      timezone: "Asia/Kolkata",
      tags: ["Admin"],
      description: "Platform Administrator",
    },
  });

  // ==========================
  // Mentors
  // ==========================
  const mentors = [
    {
      name: "Rahul Sharma",
      email: "mentor1@mentorque.com",
      tags: ["Tech", "Big Tech", "Frontend", "Good Communication"],
      description: "Senior Frontend Engineer at Google",
    },
    {
      name: "Aman Gupta",
      email: "mentor2@mentorque.com",
      tags: ["Tech", "Backend", "Public Company"],
      description: "Backend Engineer at Adobe",
    },
    {
      name: "Neha Singh",
      email: "mentor3@mentorque.com",
      tags: ["Tech", "Full Stack", "India"],
      description: "Senior MERN Developer",
    },
    {
      name: "Priya Verma",
      email: "mentor4@mentorque.com",
      tags: ["Mock Interview", "DSA", "Good Communication"],
      description: "Interview Specialist",
    },
    {
      name: "Rohit Kumar",
      email: "mentor5@mentorque.com",
      tags: ["Career Guidance", "Resume Review", "Ireland"],
      description: "Career Mentor",
    },
  ];

  for (const mentor of mentors) {
    await prisma.user.upsert({
      where: { email: mentor.email },
      update: {
        ...mentor,
      },
      create: {
        ...mentor,
        password,
        role: "MENTOR",
        timezone: "Asia/Kolkata",
      },
    });
  }

  // ==========================
  // Users
  // ==========================
  for (let i = 1; i <= 10; i++) {
    await prisma.user.upsert({
      where: {
        email: `user${i}@mentorque.com`,
      },
      update: {
        name: `User ${i}`,
        tags: ["Tech", "Frontend"],
        description: "Looking for Resume Review",
      },
      create: {
        name: `User ${i}`,
        email: `user${i}@mentorque.com`,
        password,
        role: "USER",
        timezone: "Asia/Kolkata",
        tags: ["Tech", "Frontend"],
        description: "Looking for Resume Review",
      },
    });
  }

  console.log("✅ Seed completed successfully");
}

main()
  .catch((err) => {
    console.error(err);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
