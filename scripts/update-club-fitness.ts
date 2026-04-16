import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  addDoc,
  deleteDoc,
  doc,
  serverTimestamp,
} from "firebase/firestore";

import { firebaseConfig } from "./firebase-config";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function updateClubFitness() {
  console.log("Updating Club Fitness Angola in Firestore...\n");

  const accountsRef = collection(db, "accounts");

  // Try to find existing entry
  const variants = [
    "Club Fitness",
    "Club Fitness Angola",
    "club fitness",
    "Club fitness",
  ];

  let accountId: string | null = null;

  for (const variant of variants) {
    const q = query(accountsRef, where("company", "==", variant));
    const snap = await getDocs(q);
    if (!snap.empty) {
      accountId = snap.docs[0].id;
      console.log(`  Found account as "${variant}" → ${accountId}`);
      break;
    }
  }

  if (!accountId) {
    console.log("  Account not found — creating new entry...");
    const newRef = await addDoc(accountsRef, {
      name: "Club Fitness Angola",
      company: "Club Fitness Angola",
      createdAt: serverTimestamp(),
    });
    accountId = newRef.id;
    console.log(`  ✓ Created account stub → ${accountId}`);
  }

  // ─── Update with researched details ────────────────────────
  const updatedData = {
    name: "Club Fitness Angola",
    company: "Club Fitness Angola",
    email: "Clubfitnessangola@gmail.com",
    avatar: null,
    logo: null,
    platform: "Facebook",
    industry: "Fitness & Wellness",
    website: "https://clubfitnessangola.com",
    accountType: "Professional Services",
    description:
      "Full-service 24/7 fitness center in Angola, Indiana, serving Steuben County and surrounding communities. Features a comprehensive facility with free weights, cardio equipment, cable machines, racquetball and basketball courts, sauna, tanning beds, a smoothie bar, on-site salon, and a supervised Kids Club. Offers group fitness classes (yoga, Zumba), personal training, and a judgment-free, community-driven atmosphere. Rated 4.7/5 stars. Tagline: \"Build Your Tomorrow.\" Recently under new local ownership with ongoing facility improvements.",
    brandVoice:
      "Welcoming, community-first, and motivational. Judgment-free and inclusive — \"Fitness is more fun together!\" Encouraging tone that speaks to beginners and experienced athletes alike. Warm, family-oriented, and proud of the local Angola community.",
    targetAudience:
      "Angola, Fremont, and Steuben County residents of all fitness levels — from first-timers to seasoned athletes. Families, young professionals, seniors, and anyone looking for a welcoming gym community.",
    brandColors: ["#1A1A1A", "#E63946", "#FFFFFF"],
    socialHandles: {
      facebook: "clubfitnessangola",
    },
    servicesSubscribed: [],
    contractStart: null,
    contractEnd: null,
    monthlyRetainer: null,
    status: "prospect",
    notes: [
      "ADDRESS: 605 W County Road 275 N, Angola, IN 46703",
      "PHONE: (260) 665-5919",
      "EMAIL: Clubfitnessangola@gmail.com",
      "HOURS: Open 24/7",
      "",
      "RATING: 4.7/5 stars (22 reviews on Google). Members praise cleanliness, friendly staff, equipment variety, and reasonable pricing.",
      "",
      "OWNERSHIP: Recently acquired by new local owner who is making facility improvements. Owner name not publicly listed.",
      "",
      "FACILITY HIGHLIGHTS:",
      "  • 24/7 key-card access",
      "  • Free weight room with racks",
      "  • Full cardio floor",
      "  • Cable machines & strength equipment",
      "  • Racquetball court (professional spec)",
      "  • Basketball court",
      "  • Sauna",
      "  • Tanning beds (included in Premium/VIP, add-on for Basic)",
      "  • Smoothie bar (fresh fruits, protein, health ingredients)",
      "  • On-site salon",
      "  • Aerobic/group fitness room",
      "  • Supervised Kids Club (during peak hours)",
      "",
      "MEMBERSHIP TIERS: Basic, Premium (includes tanning), VIP (includes tanning), Family plans, Corporate plans. Specific pricing not publicly listed — tour-based sales model.",
      "",
      "GROUP CLASSES: Yoga, Zumba, and other daily group fitness sessions.",
      "",
      "CANCELLATION: In-person at front desk or certified letter, 30 days advance notice.",
      "",
      "MARKETING OPPORTUNITY: Clean modern website (clubfitnessangola.com) but limited social media presence — only Facebook, no Instagram. Strong candidate for social media management, content creation (workout videos, member spotlights, class promos), and local digital advertising.",
    ].join("\n"),
    metadata: null,
  };

  await updateDoc(doc(db, "accounts", accountId), updatedData);
  console.log("  ✓ Account details updated with researched data");

  // ─── Replace contacts ─────────────────────────────────────
  const existingContacts = await getDocs(
    query(collection(db, "contacts"), where("accountId", "==", accountId))
  );
  for (const c of existingContacts.docs) await deleteDoc(c.ref);

  const contacts = [
    {
      accountId,
      name: "Club Fitness Angola",
      title: "Front Desk / Management",
      email: "Clubfitnessangola@gmail.com",
      phone: "(260) 665-5919",
      isPrimary: true,
      notes: "Primary contact. New local owner name not publicly available — reach via front desk or email.",
      avatar: null,
      createdAt: serverTimestamp(),
    },
  ];

  for (const contact of contacts) {
    await addDoc(collection(db, "contacts"), contact);
    console.log(`  ✓ Contact: ${contact.name} (${contact.title})`);
  }

  // ─── Services (menu_items collection) ──────────────────────
  const existingItems = await getDocs(
    query(collection(db, "menu_items"), where("accountId", "==", accountId))
  );
  for (const d of existingItems.docs) await deleteDoc(d.ref);

  const services = [
    // Core Services
    { name: "24/7 Gym Access", description: "Round-the-clock key-card access to the full facility, 365 days a year", price: null, category: "Core Services", available: true },
    { name: "Free Weight Room", description: "Full free weight area with dumbbells, barbells, benches, and power racks", price: null, category: "Core Services", available: true },
    { name: "Cardio Floor", description: "Treadmills, ellipticals, bikes, and other state-of-the-art cardio equipment", price: null, category: "Core Services", available: true },
    { name: "Cable & Strength Machines", description: "Full range of cable machines and plate-loaded strength equipment", price: null, category: "Core Services", available: true },
    { name: "Racquetball Court", description: "Professional-spec racquetball court with high-quality walls and safety flooring", price: null, category: "Core Services", available: true },
    { name: "Basketball Court", description: "Indoor basketball court for pickup games and training", price: null, category: "Core Services", available: true },
    { name: "Sauna", description: "Relaxing sauna for post-workout recovery", price: null, category: "Core Services", available: true },

    // Specialty Services
    { name: "Personal Training", description: "One-on-one expert guidance from certified personal trainers", price: null, category: "Specialty", available: true },
    { name: "Group Fitness Classes", description: "Daily group sessions including yoga, Zumba, and more in the dedicated aerobic room", price: null, category: "Specialty", available: true },
    { name: "Kids Club", description: "Supervised childcare area available during peak hours so parents can work out worry-free", price: null, category: "Specialty", available: true },

    // Add-Ons
    { name: "Tanning Beds", description: "Premium tanning beds — included with Premium/VIP memberships, available as add-on for Basic", price: null, category: "Add-Ons", available: true },
    { name: "Smoothie Bar", description: "Fresh smoothies made with fruits, protein, and healthy ingredients — available to all members", price: null, category: "Add-Ons", available: true },
    { name: "On-Site Salon", description: "Full-service salon located inside the Club Fitness facility", price: null, category: "Add-Ons", available: true },

    // Membership Plans
    { name: "Basic Membership", description: "24/7 gym access, equipment, group classes, racquetball & basketball courts, sauna", price: null, category: "Membership Plans", available: true },
    { name: "Premium Membership", description: "Everything in Basic plus tanning beds included", price: null, category: "Membership Plans", available: true },
    { name: "VIP Membership", description: "Full access to all amenities including tanning and premium perks", price: null, category: "Membership Plans", available: true },
    { name: "Family Plan", description: "Discounted multi-member household plan with full facility access", price: null, category: "Membership Plans", available: true },
    { name: "Corporate Plan", description: "Group membership plans for businesses and organizations", price: null, category: "Membership Plans", available: true },
  ];

  for (const svc of services) {
    await addDoc(collection(db, "menu_items"), {
      ...svc,
      accountId,
      image: null,
      createdAt: serverTimestamp(),
    });
  }
  console.log(`  ✓ ${services.length} services & plans added`);

  console.log("\n✅ Club Fitness Angola fully updated in the CRM!");
  process.exit(0);
}

updateClubFitness().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
