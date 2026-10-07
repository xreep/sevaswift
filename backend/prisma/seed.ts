import { PrismaClient, Role, UserStatus, VerificationStatus, JobPriority, JobStatus } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  const passwordHash = await bcrypt.hash('Demo@123', 10);

  const services = await Promise.all([
    prisma.service.upsert({
      where: { id: 'plumbing' },
      update: {},
      create: { id: 'plumbing', name: 'Plumbing Repair', category: 'Plumbing', baseFee: 49900, icon: '🔧', description: 'Leaks, pipe bursts, drain cleaning' },
    }),
    prisma.service.upsert({
      where: { id: 'electrical' },
      update: {},
      create: { id: 'electrical', name: 'Electrical Repair', category: 'Electrical', baseFee: 59900, icon: '⚡', description: 'Wiring, outlets, circuit breakers' },
    }),
    prisma.service.upsert({
      where: { id: 'ac_repair' },
      update: {},
      create: { id: 'ac_repair', name: 'AC Repair', category: 'HVAC', baseFee: 79900, icon: '❄️', description: 'AC not cooling, gas refill, compressor' },
    }),
    prisma.service.upsert({
      where: { id: 'appliance' },
      update: {},
      create: { id: 'appliance', name: 'Appliance Repair', category: 'Appliance', baseFee: 69900, icon: '🧺', description: 'Washing machine, fridge, microwave' },
    }),
    prisma.service.upsert({
      where: { id: 'carpentry' },
      update: {},
      create: { id: 'carpentry', name: 'Carpentry', category: 'Carpentry', baseFee: 49900, icon: '🪚', description: 'Furniture repair, door/window fixing' },
    }),
    prisma.service.upsert({
      where: { id: 'painting' },
      update: {},
      create: { id: 'painting', name: 'Painting Services', category: 'Painting', baseFee: 89900, icon: '🎨', description: 'Wall painting, touch-ups, waterproofing' },
    }),
    prisma.service.upsert({
      where: { id: 'geyser' },
      update: {},
      create: { id: 'geyser', name: 'Geyser Repair', category: 'Plumbing', baseFee: 59900, icon: '🚿', description: 'Geyser not heating, leakage, installation' },
    }),
    prisma.service.upsert({
      where: { id: 'ro_purifier' },
      update: {},
      create: { id: 'ro_purifier', name: 'RO Purifier Service', category: 'Appliance', baseFee: 49900, icon: '💧', description: 'RO installation, filter change, repair' },
    }),
    prisma.service.upsert({
      where: { id: 'pest_control' },
      update: {},
      create: { id: 'pest_control', name: 'Pest Control', category: 'Cleaning', baseFee: 39900, icon: '🐜', description: 'Termite, cockroach, mosquito treatment' },
    }),
    prisma.service.upsert({
      where: { id: 'deep_cleaning' },
      update: {},
      create: { id: 'deep_cleaning', name: 'Deep Cleaning', category: 'Cleaning', baseFee: 69900, icon: '🧹', description: 'Full home deep cleaning, sanitization' },
    }),
  ]);

  console.log(`Created ${services.length} services`);

  const customer = await prisma.user.upsert({
    where: { email: 'customer@demo.sevaswift' },
    update: {},
    create: {
      email: 'customer@demo.sevaswift',
      name: 'Demo Customer',
      passwordHash,
      role: Role.CUSTOMER,
      status: UserStatus.ACTIVE,
      emailVerified: true,
    },
  });

  const technician = await prisma.user.upsert({
    where: { email: 'tech@demo.sevaswift' },
    update: {},
    create: {
      email: 'tech@demo.sevaswift',
      name: 'Demo Technician',
      passwordHash,
      role: Role.TECHNICIAN,
      status: UserStatus.ACTIVE,
      emailVerified: true,
    },
  });

  const admin = await prisma.user.upsert({
    where: { email: 'admin@demo.sevaswift' },
    update: {},
    create: {
      email: 'admin@demo.sevaswift',
      name: 'Demo Admin',
      passwordHash,
      role: Role.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerified: true,
    },
  });

  console.log('Created demo accounts');

  const techProfile = await prisma.technicianProfile.upsert({
    where: { userId: technician.id },
    update: {},
    create: {
      userId: technician.id,
      verificationStatus: VerificationStatus.VERIFIED,
      ratingAvg: 4.5,
      ratingCount: 12,
      completedJobs: 47,
      isOnline: true,
      lastLocation: '28.6139,77.2090',
    },
  });

  console.log('Created technician profile:', techProfile.id);

  const plumbingService = await prisma.service.findUnique({ where: { id: 'plumbing' } });
  const electricalService = await prisma.service.findUnique({ where: { id: 'electrical' } });
  const acService = await prisma.service.findUnique({ where: { id: 'ac_repair' } });

  if (plumbingService) {
    await prisma.technicianSkill.upsert({
      where: { technicianId_serviceId: { technicianId: techProfile.id, serviceId: plumbingService.id } },
      update: {},
      create: { technicianId: techProfile.id, serviceId: plumbingService.id },
    });
  }

  if (electricalService) {
    await prisma.technicianSkill.upsert({
      where: { technicianId_serviceId: { technicianId: techProfile.id, serviceId: electricalService.id } },
      update: {},
      create: { technicianId: techProfile.id, serviceId: electricalService.id },
    });
  }

  if (acService) {
    await prisma.technicianSkill.upsert({
      where: { technicianId_serviceId: { technicianId: techProfile.id, serviceId: acService.id } },
      update: {},
      create: { technicianId: techProfile.id, serviceId: acService.id },
    });
  }

  await prisma.serviceArea.upsert({
    where: { id: 'tech-area-1' },
    update: {},
    create: {
      id: 'tech-area-1',
      technicianId: techProfile.id,
      centerLat: 28.6139,
      centerLng: 77.2090,
      radiusKm: 15,
    },
  });

  console.log('Created technician profile with skills and service area');

  const cities = [
    { name: 'Delhi', lat: 28.6139, lng: 77.2090 },
    { name: 'Mumbai', lat: 19.0760, lng: 72.8777 },
    { name: 'Bangalore', lat: 12.9716, lng: 77.5946 },
    { name: 'Hyderabad', lat: 17.3850, lng: 78.4867 },
  ];

  const allServices = await prisma.service.findMany();

  for (const city of cities) {
    for (let i = 0; i < 5; i++) {
      const techUser = await prisma.user.create({
        data: {
          email: `tech_${city.name.toLowerCase()}_${i}@demo.sevaswift`,
          name: `Tech ${city.name} ${i + 1}`,
          passwordHash,
          role: Role.TECHNICIAN,
          status: UserStatus.ACTIVE,
          emailVerified: true,
        },
      });

      const techProfile = await prisma.technicianProfile.create({
        data: {
          userId: techUser.id,
          verificationStatus: VerificationStatus.VERIFIED,
          ratingAvg: 4.0 + Math.random() * 1.0,
          ratingCount: Math.floor(Math.random() * 50),
          completedJobs: Math.floor(Math.random() * 100),
          isOnline: Math.random() > 0.3,
          lastLocation: `${city.lat + (Math.random() - 0.5) * 0.1},${city.lng + (Math.random() - 0.5) * 0.1}`,
        },
      });

      const numSkills = 1 + Math.floor(Math.random() * 3);
      const shuffledServices = [...allServices].sort(() => Math.random() - 0.5);
      for (let j = 0; j < numSkills; j++) {
        await prisma.technicianSkill.create({
          data: {
            technicianId: techProfile.id,
            serviceId: shuffledServices[j].id,
          },
        });
      }

      await prisma.serviceArea.create({
        data: {
          technicianId: techProfile.id,
          centerLat: city.lat + (Math.random() - 0.5) * 0.1,
          centerLng: city.lng + (Math.random() - 0.5) * 0.1,
          radiusKm: 10 + Math.floor(Math.random() * 10),
        },
      });
    }
  }

  console.log('Created 20 demo technicians across 4 cities');

  console.log('Seeding completed!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });