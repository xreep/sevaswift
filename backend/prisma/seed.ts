import crypto from 'crypto';
import {
  OfferStatus,
  Prisma,
  PrismaClient,
  Role,
  UserStatus,
  VerificationStatus,
  type JobStatus,
} from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** India Standard Time offset; demo activity follows local working hours. */
const IST_OFFSET = 5.5 * HOUR;
const HISTORY_DAYS = 30;

// Deterministic PRNG so every seed run produces the same demo data.
let state = 42;
const random = () => {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (min: number, max: number) => min + random() * (max - min);
const pick = <T>(list: T[]): T => list[Math.floor(random() * list.length)];

const CITIES = [
  { name: 'Delhi', lat: 28.6139, lng: 77.209 },
  { name: 'Mumbai', lat: 19.076, lng: 72.8777 },
  { name: 'Bangalore', lat: 12.9716, lng: 77.5946 },
  { name: 'Hyderabad', lat: 17.385, lng: 78.4867 },
];

const TECH_NAMES = [
  ['Ravi Kumar', 'Imran Shaikh', 'Suresh Yadav', 'Amit Verma', 'Deepak Singh'],
  ['Santosh Patil', 'Rahul Jadhav', 'Faizan Qureshi', 'Ganesh More', 'Vinod Pawar'],
  ['Manjunath Gowda', 'Prakash Rao', 'Syed Akbar', 'Naveen Kumar', 'Chandra Shekar'],
  ['Srinivas Reddy', 'Mohammed Ali', 'Venkatesh Naidu', 'Kiran Goud', 'Ramesh Babu'],
];
const CUSTOMER_NAMES = [
  'Priya Sharma',
  'Arjun Mehta',
  'Neha Gupta',
  'Karan Malhotra',
  'Ananya Iyer',
  'Rohit Desai',
  'Sneha Kulkarni',
  'Vikram Nair',
  'Pooja Reddy',
  'Aditi Joshi',
  'Sameer Khan',
  'Meera Pillai',
];
const STREETS = [
  'Main Road',
  'Cross Road',
  'Ring Road',
  'Station Road',
  'Park Street',
  'Temple Road',
  'Lake View',
];
const ISSUES: Record<string, string[]> = {
  plumbing: [
    'Pipe under the kitchen sink burst',
    'Bathroom tap leaking non-stop',
    'Drain blocked, water backing up',
  ],
  electrical: [
    'Power keeps tripping in the living room',
    'Sparks from the switchboard',
    'No power in two rooms',
  ],
  ac_repair: ['AC running but not cooling', 'Water dripping from indoor unit', 'AC not turning on'],
  appliance: ['Washing machine stopped mid-cycle', 'Fridge not cooling', 'Microwave sparking'],
  geyser: ['Geyser not heating', 'Geyser leaking from the bottom'],
  ro_purifier: ['RO purifier leaking', 'Water tastes salty'],
  carpentry: ['Main door lock jammed', 'Wardrobe hinge broke'],
  painting: ['Damp patch spreading on ceiling'],
  pest_control: ['Cockroach infestation in kitchen'],
  deep_cleaning: ['Post-flood cleanup needed'],
};

async function main() {
  console.log('Seeding database...');

  const passwordHash = await bcrypt.hash('Demo@123', 10);

  const services = await Promise.all([
    prisma.service.upsert({
      where: { id: 'plumbing' },
      update: {},
      create: {
        id: 'plumbing',
        name: 'Plumbing Repair',
        category: 'Plumbing',
        baseFee: 49900,
        icon: '🔧',
        description: 'Leaks, pipe bursts, drain cleaning',
      },
    }),
    prisma.service.upsert({
      where: { id: 'electrical' },
      update: {},
      create: {
        id: 'electrical',
        name: 'Electrical Repair',
        category: 'Electrical',
        baseFee: 59900,
        icon: '⚡',
        description: 'Wiring, outlets, circuit breakers',
      },
    }),
    prisma.service.upsert({
      where: { id: 'ac_repair' },
      update: {},
      create: {
        id: 'ac_repair',
        name: 'AC Repair',
        category: 'HVAC',
        baseFee: 79900,
        icon: '❄️',
        description: 'AC not cooling, gas refill, compressor',
      },
    }),
    prisma.service.upsert({
      where: { id: 'appliance' },
      update: {},
      create: {
        id: 'appliance',
        name: 'Appliance Repair',
        category: 'Appliance',
        baseFee: 69900,
        icon: '🧺',
        description: 'Washing machine, fridge, microwave',
      },
    }),
    prisma.service.upsert({
      where: { id: 'carpentry' },
      update: {},
      create: {
        id: 'carpentry',
        name: 'Carpentry',
        category: 'Carpentry',
        baseFee: 49900,
        icon: '🪚',
        description: 'Furniture repair, door/window fixing',
      },
    }),
    prisma.service.upsert({
      where: { id: 'painting' },
      update: {},
      create: {
        id: 'painting',
        name: 'Painting Services',
        category: 'Painting',
        baseFee: 89900,
        icon: '🎨',
        description: 'Wall painting, touch-ups, waterproofing',
      },
    }),
    prisma.service.upsert({
      where: { id: 'geyser' },
      update: {},
      create: {
        id: 'geyser',
        name: 'Geyser Repair',
        category: 'Plumbing',
        baseFee: 59900,
        icon: '🚿',
        description: 'Geyser not heating, leakage, installation',
      },
    }),
    prisma.service.upsert({
      where: { id: 'ro_purifier' },
      update: {},
      create: {
        id: 'ro_purifier',
        name: 'RO Purifier Service',
        category: 'Appliance',
        baseFee: 49900,
        icon: '💧',
        description: 'RO installation, filter change, repair',
      },
    }),
    prisma.service.upsert({
      where: { id: 'pest_control' },
      update: {},
      create: {
        id: 'pest_control',
        name: 'Pest Control',
        category: 'Cleaning',
        baseFee: 39900,
        icon: '🐜',
        description: 'Termite, cockroach, mosquito treatment',
      },
    }),
    prisma.service.upsert({
      where: { id: 'deep_cleaning' },
      update: {},
      create: {
        id: 'deep_cleaning',
        name: 'Deep Cleaning',
        category: 'Cleaning',
        baseFee: 69900,
        icon: '🧹',
        description: 'Full home deep cleaning, sanitization',
      },
    }),
  ]);

  console.log(`Created ${services.length} services`);
  const allServices = await prisma.service.findMany({ orderBy: { id: 'asc' } });

  // --- Demo accounts -------------------------------------------------------
  const account = (email: string, name: string, role: Role, phone: string) =>
    prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        name,
        phone,
        passwordHash,
        role,
        status: UserStatus.ACTIVE,
        emailVerified: true,
      },
    });

  const customer = await account(
    'customer@demo.sevaswift',
    'Demo Customer',
    Role.CUSTOMER,
    '+919800000001'
  );
  const technician = await account(
    'tech@demo.sevaswift',
    'Demo Technician',
    Role.TECHNICIAN,
    '+919800000002'
  );
  await account('admin@demo.sevaswift', 'Demo Admin', Role.ADMIN, '+919800000003');

  // The demo technician sits in central Delhi with every skill, so a Delhi request reaches them.
  const demoTech = await prisma.technicianProfile.upsert({
    where: { userId: technician.id },
    update: { lastLat: 28.6315, lastLng: 77.2167, locationUpdatedAt: new Date() },
    create: {
      userId: technician.id,
      verificationStatus: VerificationStatus.VERIFIED,
      isOnline: true,
      lastLat: 28.6315,
      lastLng: 77.2167,
      locationUpdatedAt: new Date(),
    },
  });
  await prisma.technicianSkill.createMany({
    data: allServices.map(s => ({ technicianId: demoTech.id, serviceId: s.id })),
    skipDuplicates: true,
  });
  console.log('Created demo accounts');

  // --- Field technicians across four cities --------------------------------
  const fleet: { profileId: string; userId: string; city: number; skills: string[] }[] = [
    { profileId: demoTech.id, userId: technician.id, city: 0, skills: allServices.map(s => s.id) },
  ];
  for (const [c, city] of CITIES.entries()) {
    for (let i = 0; i < 5; i++) {
      const handle = `tech_${city.name.toLowerCase()}_${i}`;
      const lat = Number((city.lat + (random() - 0.5) * 0.1).toFixed(6));
      const lng = Number((city.lng + (random() - 0.5) * 0.1).toFixed(6));
      const user = await prisma.user.upsert({
        where: { email: `${handle}@demo.sevaswift` },
        update: { name: TECH_NAMES[c][i] },
        create: {
          email: `${handle}@demo.sevaswift`,
          name: TECH_NAMES[c][i],
          phone: `+9198${String(10000000 + c * 100 + i).padStart(8, '0')}`,
          passwordHash,
          role: Role.TECHNICIAN,
          status: UserStatus.ACTIVE,
          emailVerified: true,
        },
      });
      const isOnline = random() > 0.3;
      const profile = await prisma.technicianProfile.upsert({
        where: { userId: user.id },
        // Keep demo positions current on re-seed (locations drift as technicians move).
        update: { lastLat: lat, lastLng: lng, locationUpdatedAt: new Date() },
        create: {
          userId: user.id,
          verificationStatus: VerificationStatus.VERIFIED,
          isOnline,
          lastLat: lat,
          lastLng: lng,
          locationUpdatedAt: new Date(),
        },
      });
      // Plumbing or electrical plus one or two more, so every city covers the common emergencies.
      const skills = new Set([i % 2 === 0 ? 'plumbing' : 'electrical']);
      const extra = 1 + Math.floor(random() * 2);
      for (let j = 0; j < extra; j++) skills.add(pick(allServices).id);
      if (i === 4) skills.add('ac_repair');
      await prisma.technicianSkill.createMany({
        data: [...skills].map(serviceId => ({ technicianId: profile.id, serviceId })),
        skipDuplicates: true,
      });
      const current = await prisma.technicianSkill.findMany({
        where: { technicianId: profile.id },
        select: { serviceId: true },
      });
      fleet.push({
        profileId: profile.id,
        userId: user.id,
        city: c,
        skills: current.map(s => s.serviceId),
      });
    }
  }
  console.log(`Created ${fleet.length - 1} field technicians across ${CITIES.length} cities`);

  // --- Technicians waiting for verification (admin queue) ------------------
  for (const [i, name] of ['Harish Chauhan', 'Lakshmi Narayan'].entries()) {
    const user = await account(
      `applicant_${i}@demo.sevaswift`,
      name,
      Role.TECHNICIAN,
      `+91970000000${i}`
    );
    await prisma.technicianProfile.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        verificationStatus: VerificationStatus.PENDING,
        skills: { create: [{ serviceId: i === 0 ? 'plumbing' : 'ac_repair' }] },
      },
    });
  }

  // --- Customers ------------------------------------------------------------
  const customers = [customer.id];
  for (const [i, name] of CUSTOMER_NAMES.entries()) {
    const user = await account(
      `customer_${i}@demo.sevaswift`,
      name,
      Role.CUSTOMER,
      `+91990000${String(i).padStart(4, '0')}`
    );
    customers.push(user.id);
  }

  await seedHistory(
    fleet,
    customers,
    allServices.map(s => s.id)
  );
  await syncTechnicianTotals();
  console.log('Seeding completed!');
}

interface FleetMember {
  profileId: string;
  userId: string;
  city: number;
  skills: string[];
}

/** Midnight IST of the day `daysAgo` before today, as a UTC timestamp. */
function istMidnight(daysAgo: number) {
  const nowIst = Date.now() + IST_OFFSET;
  return Math.floor(nowIst / DAY) * DAY - IST_OFFSET - daysAgo * DAY;
}

/**
 * Thirty days of realistic service history (requests, dispatch offers, status
 * logs, reviews, technician shifts) so the dashboards and reports have data.
 * Runs once: skipped when history already exists.
 */
async function seedHistory(fleet: FleetMember[], customers: string[], serviceIds: string[]) {
  const existing = await prisma.jobRequest.count({ where: { address: { endsWith: '(demo)' } } });
  if (existing > 0) {
    console.log('Demo history already present, skipping');
    return;
  }

  const now = Date.now();
  const jobs: Prisma.JobRequestCreateManyInput[] = [];
  const history: Prisma.JobStatusHistoryCreateManyInput[] = [];
  const offers: Prisma.JobOfferCreateManyInput[] = [];
  const reviews: Prisma.ReviewCreateManyInput[] = [];
  const shifts: Prisma.AvailabilityLogCreateManyInput[] = [];
  const busyUntil = new Map<string, number>();
  const names = new Map(
    (
      await prisma.user.findMany({
        where: { id: { in: fleet.map(f => f.userId) } },
        select: { id: true, name: true },
      })
    ).map(u => [u.id, u.name])
  );

  // Shifts: online roughly 08:00–21:00 IST each day.
  for (const tech of fleet) {
    for (let d = HISTORY_DAYS; d >= 1; d--) {
      if (random() < 0.12) continue; // day off
      const start = istMidnight(d) + between(7.5, 9.5) * HOUR;
      const end = istMidnight(d) + between(19, 22) * HOUR;
      shifts.push({ technicianId: tech.profileId, isOnline: true, at: new Date(start) });
      shifts.push({ technicianId: tech.profileId, isOnline: false, at: new Date(end) });
    }
  }

  const hourWeights = [9, 10, 10, 11, 12, 13, 17, 18, 19, 19, 20, 21, 8, 14, 16];
  for (let d = HISTORY_DAYS; d >= 0; d--) {
    const perDay = d === 0 ? 4 : 5 + Math.floor(random() * 6);
    // Chronological order keeps "busy until" bookkeeping correct.
    const times = Array.from(
      { length: perDay },
      () => istMidnight(d) + (pick(hourWeights) + random()) * HOUR
    ).sort((a, b) => a - b);
    for (const createdAt of times) {
      if (createdAt > now - 20 * MINUTE) continue;
      const cityIdx = Math.floor(random() * CITIES.length);
      const city = CITIES[cityIdx];
      // Mostly services the city's technicians cover; occasionally one nobody nearby offers.
      const covered = [...new Set(fleet.filter(f => f.city === cityIdx).flatMap(f => f.skills))];
      const serviceId =
        random() < 0.6
          ? pick(['plumbing', 'electrical', 'ac_repair'])
          : random() < 0.9
            ? pick(covered)
            : pick(serviceIds);
      const lat = city.lat + (random() - 0.5) * 0.12;
      const lng = city.lng + (random() - 0.5) * 0.12;
      const id = crypto.randomUUID();
      // The demo customer and technician get past jobs only, so they start the demo idle.
      const customerId =
        d > 0 && d <= 20 && random() < 0.15 ? customers[0] : pick(customers.slice(1));
      const priority = random() < 0.65 ? 'URGENT' : 'NORMAL';
      const steps: { to: JobStatus; at: number; note?: string }[] = [
        { to: 'CREATED', at: createdAt, note: 'Request raised' },
      ];

      const candidates = fleet
        .filter(
          f =>
            f.city === cityIdx &&
            f.skills.includes(serviceId) &&
            (busyUntil.get(f.userId) ?? 0) < createdAt &&
            !(d === 0 && f.userId === fleet[0].userId)
        )
        .map(f => ({
          f,
          km:
            Math.hypot((lat - CITIES[f.city].lat) * 111, (lng - CITIES[f.city].lng) * 105) *
            between(0.3, 0.9),
        }))
        .sort((a, b) => a.km - b.km);

      const roll = random();
      const job: Prisma.JobRequestCreateManyInput = {
        id,
        customerId,
        serviceId,
        lat,
        lng,
        address: `${10 + Math.floor(random() * 290)}, ${pick(STREETS)}, ${city.name} (demo)`,
        description: pick(ISSUES[serviceId] ?? ['Needs urgent repair']),
        priority,
        createdAt: new Date(createdAt),
        status: 'CREATED',
      };

      let t = createdAt + between(1, 3) * 1000;
      let round = 0;
      let acceptedBy: (typeof candidates)[number] | null = null;
      const cancelEarly = roll < 0.08;
      for (const c of candidates.slice(0, 3)) {
        round++;
        const eta = Math.max(1, Math.ceil((c.km / 25) * 60));
        const offeredAt = t;
        const outcome = cancelEarly
          ? 'CANCELLED'
          : round === 1
            ? random() < 0.78
              ? 'ACCEPTED'
              : pick(['REJECTED', 'EXPIRED'])
            : random() < 0.7
              ? 'ACCEPTED'
              : pick(['REJECTED', 'EXPIRED']);
        const respondedAt =
          outcome === 'EXPIRED' ? offeredAt + 60_000 : offeredAt + between(8, 50) * 1000;
        if (round === 1)
          steps.push({
            to: 'MATCHED',
            at: offeredAt,
            note: `Offered to ${names.get(c.f.userId)} (${c.km.toFixed(2)} km, ~${eta} min)`,
          });
        offers.push({
          jobId: id,
          technicianId: c.f.profileId,
          round,
          distanceKm: Math.round(c.km * 100) / 100,
          etaMinutes: eta,
          status: outcome as OfferStatus,
          offeredAt: new Date(offeredAt),
          expiresAt: new Date(offeredAt + 60_000),
          respondedAt: new Date(cancelEarly ? createdAt + between(40, 55) * 1000 : respondedAt),
        });
        job.dispatchRounds = round;
        if (cancelEarly) break;
        t = respondedAt;
        if (outcome === 'ACCEPTED') {
          acceptedBy = c;
          break;
        }
      }

      if (cancelEarly) {
        const at = createdAt + between(40, 55) * 1000;
        steps.push({ to: 'CANCELLED', at, note: 'Cancelled by customer: Fixed it myself' });
        Object.assign(job, { status: 'CANCELLED', cancelledAt: new Date(at) });
      } else if (!acceptedBy) {
        const at = t + 500;
        steps.push({
          to: 'EXPIRED',
          at,
          note: candidates.length
            ? 'No technician accepted after 3 offers'
            : 'No available technician within 15 km',
        });
        // Older unassigned requests were closed by the ops team; recent ones still need assignment.
        if (d > 0) {
          const closed = at + between(5, 20) * MINUTE;
          steps.push({
            to: 'CANCELLED',
            at: closed,
            note: 'Cancelled by admin: customer arranged help elsewhere',
          });
          Object.assign(job, { status: 'CANCELLED', cancelledAt: new Date(closed) });
        } else {
          job.status = 'EXPIRED';
        }
      } else {
        const accepted = t;
        const arrived = accepted + Math.max(4, acceptedBy.km * between(2.2, 3.4)) * MINUTE;
        const started = arrived + between(1, 4) * MINUTE;
        const completed = started + between(20, 85) * MINUTE;
        const tech = acceptedBy.f;
        Object.assign(job, {
          technicianId: tech.userId,
          acceptedAt: new Date(accepted),
          responseTimeSecs: Math.round((accepted - createdAt) / 1000),
        });
        steps.push({ to: 'ACCEPTED', at: accepted, note: `Accepted by ${names.get(tech.userId)}` });
        if (completed > now || roll > 0.95) {
          // A few recent jobs are still in progress for the live views.
          const demo = customerId === customers[0] || tech.userId === fleet[0].userId;
          if (completed > now && accepted < now && !demo) {
            steps.push({ to: 'EN_ROUTE', at: accepted + 30_000 });
            job.status = 'EN_ROUTE';
            busyUntil.set(tech.userId, Number.MAX_SAFE_INTEGER);
          } else {
            const at = accepted + between(2, 6) * MINUTE;
            steps.push({ to: 'CANCELLED', at, note: 'Cancelled by customer: Issue resolved' });
            Object.assign(job, { status: 'CANCELLED', cancelledAt: new Date(at) });
          }
        } else {
          steps.push({ to: 'EN_ROUTE', at: accepted + between(20, 90) * 1000 });
          steps.push({ to: 'ARRIVED', at: arrived });
          steps.push({ to: 'IN_PROGRESS', at: started });
          steps.push({ to: 'COMPLETED', at: completed });
          Object.assign(job, {
            status: 'COMPLETED',
            arrivedAt: new Date(arrived),
            completedAt: new Date(completed),
          });
          busyUntil.set(tech.userId, completed);
          if (random() < 0.72) {
            const r = random();
            const rating = r < 0.52 ? 5 : r < 0.82 ? 4 : r < 0.93 ? 3 : r < 0.97 ? 2 : 1;
            reviews.push({
              jobId: id,
              customerId,
              rating,
              comment:
                rating >= 4
                  ? pick([
                      'Quick and professional',
                      'Arrived fast, fixed it properly',
                      'Very polite, explained the issue',
                      null,
                    ])
                  : pick(['Took longer than expected', 'Had to call twice', null]),
              createdAt: new Date(completed + between(5, 120) * MINUTE),
            });
          }
        }
      }

      jobs.push(job);
      let prev: JobStatus | null = null;
      for (const s of steps) {
        history.push({
          jobId: id,
          fromStatus: prev,
          toStatus: s.to,
          note: s.note,
          at: new Date(s.at),
        });
        prev = s.to;
      }
    }
  }

  // One request on the city edge that nobody could take, waiting for an admin to assign it.
  if (!jobs.some(j => j.status === 'EXPIRED')) {
    const id = crypto.randomUUID();
    const createdAt = now - 40 * MINUTE;
    jobs.push({
      id,
      customerId: customers[1],
      serviceId: 'plumbing',
      lat: 28.4089,
      lng: 77.3178,
      address: '42, Sector 21, Faridabad (demo)',
      description: 'Overhead tank overflowing, cannot find the valve',
      priority: 'URGENT',
      status: 'EXPIRED',
      createdAt: new Date(createdAt),
    });
    history.push(
      {
        jobId: id,
        fromStatus: null,
        toStatus: 'CREATED',
        note: 'Request raised',
        at: new Date(createdAt),
      },
      {
        jobId: id,
        fromStatus: 'CREATED',
        toStatus: 'EXPIRED',
        note: 'No available technician within 15 km',
        at: new Date(createdAt + 2000),
      }
    );
  }

  // An in-progress job keeps its technician on shift; a running job means "online now".
  const working = new Set(jobs.filter(j => j.status === 'EN_ROUTE').map(j => j.technicianId));
  const onlineNow = await prisma.technicianProfile.findMany({
    where: { isOnline: true },
    select: { id: true, userId: true },
  });
  for (const p of onlineNow) {
    shifts.push({
      technicianId: p.id,
      isOnline: true,
      at: new Date(Math.min(now - HOUR, istMidnight(0) + 8 * HOUR)),
    });
  }
  for (const f of fleet) {
    if (working.has(f.userId) && !onlineNow.some(p => p.id === f.profileId)) {
      await prisma.technicianProfile.update({
        where: { id: f.profileId },
        data: { isOnline: true },
      });
      shifts.push({ technicianId: f.profileId, isOnline: true, at: new Date(now - 2 * HOUR) });
    }
  }

  await prisma.$transaction([
    prisma.jobRequest.createMany({ data: jobs }),
    prisma.jobStatusHistory.createMany({ data: history }),
    prisma.jobOffer.createMany({ data: offers }),
    prisma.review.createMany({ data: reviews }),
    prisma.availabilityLog.createMany({ data: shifts }),
  ]);
  console.log(
    `Created ${jobs.length} historical requests, ${offers.length} offers, ${reviews.length} reviews`
  );
}

/** Recomputes each technician's rating and completed-job count from the records. */
async function syncTechnicianTotals() {
  const profiles = await prisma.technicianProfile.findMany({ select: { id: true, userId: true } });
  for (const p of profiles) {
    const [completed, ratings] = await Promise.all([
      prisma.jobRequest.count({ where: { technicianId: p.userId, status: 'COMPLETED' } }),
      prisma.review.aggregate({
        where: { job: { technicianId: p.userId } },
        _avg: { rating: true },
        _count: true,
      }),
    ]);
    await prisma.technicianProfile.update({
      where: { id: p.id },
      data: {
        completedJobs: completed,
        ratingCount: ratings._count,
        ratingAvg: ratings._avg.rating ? Math.round(ratings._avg.rating * 100) / 100 : 0,
      },
    });
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
