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

const firebaseConfig = {
  apiKey: "AIzaSyAkvNPMQ5UPnUcmXXfR9bRxGGRsxKarvr0",
  authDomain: "ai-designer-b3ea6.firebaseapp.com",
  projectId: "ai-designer-b3ea6",
  storageBucket: "ai-designer-b3ea6.firebasestorage.app",
  messagingSenderId: "309126109469",
  appId: "1:309126109469:web:781b7beaaf4900bcf1e9f4",
  measurementId: "G-P9CMTRVVHR",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function updateBillsTowing() {
  console.log("Updating Bill's Professional Towing & Repair in Firestore...\n");

  const accountsRef = collection(db, "accounts");

  // Try multiple name variants to find existing entry
  const variants = [
    "Bill's Professional Towing",
    "Bills Professional Towing",
    "Bill's Professional Towing & Repair",
    "Bills Professional Towing & Repair",
    "Bill's Professional Towing and Repair",
    "bills professional towing",
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
      name: "Bill's Professional Towing & Repair",
      company: "Bill's Professional Towing & Repair",
      createdAt: serverTimestamp(),
    });
    accountId = newRef.id;
    console.log(`  ✓ Created account stub → ${accountId}`);
  }

  // ─── Update with researched details ────────────────────────
  const updatedData = {
    name: "Bill's Professional Towing & Repair",
    company: "Bill's Professional Towing & Repair",
    email: null,
    avatar: null,
    logo: null,
    platform: "Facebook",
    industry: "Automotive Services — Towing & Repair",
    website: "https://billsprofessionaltowing.com",
    accountType: "Professional Services",
    description:
      "Family-owned and operated towing, recovery, and auto repair business serving Northeast Indiana and Southern Michigan since 1977. Two locations in Angola and Fremont, IN with 20+ employees including ASE Certified Technicians and award-winning drivers. The only AAA Approved Repair Facility in Northeast Indiana. Also a NAPA AutoCare Center and NAPA Truck Center. Known for honest, reliable service — rated 4.9/5 on SureCritic (356 reviews) and A+ rated by the BBB. Breaking ground on a third facility. Voted #1 Towing Service in Steuben County 8 years in a row (Reader's Choice).",
    brandVoice:
      "Trustworthy, hardworking, and family-oriented. Straightforward blue-collar professionalism. Emphasizes honesty, integrity, and customer-first service. Warm but no-nonsense — \"We look forward to helping you get back on the road.\"",
    targetAudience:
      "Vehicle owners, truckers, and fleet operators across NE Indiana (Angola, Fremont, Auburn, Kendallville) and Southern Michigan needing towing, roadside assistance, or auto/truck repair.",
    brandColors: ["#1A3C6E", "#E8A317", "#FFFFFF"],
    socialHandles: {
      facebook: "billsprofessionaltowing",
    },
    servicesSubscribed: [],
    contractStart: null,
    contractEnd: null,
    monthlyRetainer: null,
    status: "prospect",
    notes: [
      "LOCATIONS:",
      "  Main: 2765 W Maumee St, Angola, IN 46703",
      "  Second: 6503 Old US 27, Fremont, IN 46737",
      "  Third facility: breaking ground (expansion)",
      "",
      "PHONE: (260) 829-6287 | Toll-Free: (800) 820-6287 | Fax: (260) 624-3525",
      "HOURS: Shop Mon-Fri 8am-5pm | Towing services available 24/7",
      "",
      "OWNERSHIP:",
      "  President: Wilburn McClanahan",
      "  Additional Contact: Ashley McClanahan",
      "  DBA: Little Willies R&R Inc., Bill's Emergency Roadside Assistance",
      "  Corporation incorporated 12/31/1996",
      "",
      "CREDENTIALS & AWARDS:",
      "  • Only AAA Approved Repair Facility in NE Indiana",
      "  • NAPA AutoCare Center & NAPA Truck Center",
      "  • ASE Certified Technicians",
      "  • American Towman ACE Award (2009, 2010)",
      "  • Seasoned Business Professional of the Year — Angola Area Chamber of Commerce",
      "  • #1 Towing Service in Steuben County — 8 years in a row (Reader's Choice)",
      "  • BBB A+ Rating (not accredited, file opened 10/11/2004)",
      "  • SureCritic: 4.9/5 (356 reviews, 92% five-star)",
      "  • TowFinderHub: 4.6/5 (394 reviews)",
      "",
      "SERVICES OFFERED:",
      "  • Local & long-distance towing (light/medium/heavy)",
      "  • Semi towing",
      "  • Accident recovery & load transfers",
      "  • Emergency roadside assistance (24/7) — battery boost, fuel delivery, jumpstart, lockouts, tire changes",
      "  • Auto repair — brakes, tune-ups, engine overhauls",
      "  • Heavy truck repair",
      "  • Fleet services",
      "  • Vehicle & equipment recovery",
      "  • Classic car transport & maintenance",
      "",
      "AAA members receive 10% labor discount (max $75) on repairs.",
      "",
      "MARKETING OPPORTUNITY: Strong local reputation but minimal digital/social media presence. Website exists but no Instagram, limited social content. Good candidate for social media management, local SEO, and Google Business Profile optimization.",
    ].join("\n"),
    metadata: null,
  };

  await updateDoc(doc(db, "accounts", accountId), updatedData);
  console.log("  ✓ Account details updated with researched data");

  // ─── Replace contacts ─────────────────────────────────────
  const existingContacts = await getDocs(
    query(collection(db, "contacts"), where("accountId", "==", accountId))
  );
  for (const c of existingContacts.docs) {
    await deleteDoc(c.ref);
  }

  const contacts = [
    {
      accountId,
      name: "Wilburn McClanahan",
      title: "President / Owner",
      email: null,
      phone: "(260) 829-6287",
      isPrimary: true,
      notes:
        "Principal owner and president since founding. Listed as primary contact on BBB and all business filings.",
      avatar: null,
      createdAt: serverTimestamp(),
    },
    {
      accountId,
      name: "Ashley McClanahan",
      title: "Customer Contact",
      email: null,
      phone: "(260) 829-6287",
      isPrimary: false,
      notes:
        "Listed as customer contact on BBB profile. Part of the McClanahan family ownership.",
      avatar: null,
      createdAt: serverTimestamp(),
    },
  ];

  for (const contact of contacts) {
    await addDoc(collection(db, "contacts"), contact);
    console.log(`  ✓ Contact: ${contact.name} (${contact.title})`);
  }

  console.log("\n✅ Bill's Professional Towing & Repair fully updated in the CRM!");
  process.exit(0);
}

updateBillsTowing().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
