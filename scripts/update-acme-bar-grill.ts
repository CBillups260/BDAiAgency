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

async function updateAcmeBarGrill() {
  console.log("Updating ACME Bar & Grill in Firestore...\n");

  // Find the existing ACME Bar and Grill account
  const accountsRef = collection(db, "accounts");
  const q = query(accountsRef, where("company", "==", "ACME Bar and Grill"));
  const snap = await getDocs(q);

  // Also try alternate name formats
  let accountDoc: any = null;
  let accountId: string | null = null;

  if (!snap.empty) {
    accountDoc = snap.docs[0];
    accountId = accountDoc.id;
    console.log(`  Found account: "${accountDoc.data().company}" → ${accountId}`);
  } else {
    // Try other possible name formats
    for (const variant of [
      "ACME Bar & Grill",
      "Acme Bar and Grill",
      "Acme Bar & Grill",
      "ACME Bar and GRill",
      "ACME",
    ]) {
      const q2 = query(accountsRef, where("company", "==", variant));
      const snap2 = await getDocs(q2);
      if (!snap2.empty) {
        accountDoc = snap2.docs[0];
        accountId = accountDoc.id;
        console.log(`  Found account as "${variant}" → ${accountId}`);
        break;
      }
    }
  }

  if (!accountId) {
    console.log("  Account not found — creating new ACME Bar & Grill entry...");

    const newRef = await addDoc(accountsRef, {
      name: "ACME Bar & Grill",
      company: "ACME Bar & Grill",
      createdAt: serverTimestamp(),
    });
    accountId = newRef.id;
    console.log(`  ✓ Created account stub → ${accountId}`);
  }

  // ─── Update with researched details ────────────────────────
  const updatedData = {
    name: "ACME Bar & Grill",
    company: "ACME Bar & Grill",
    email: null,
    avatar: null,
    logo: null,
    platform: "Facebook",
    industry: "Restaurant & Food Service",
    website: "https://acmefortwayne.com",
    accountType: "Restaurant",
    description:
      "Fort Wayne's beloved neighborhood bar and grill since 1941. Located on the north side at 1105 E State Blvd, ACME has been a gathering place for over 85 years through three generations of family ownership. Now under the stewardship of Salvatori's Hospitality Group, ACME serves classic Midwestern comfort food — legendary breaded tenderloins, smoked wings, baby back ribs, brisket, pulled pork, pizza, and hearty shareables. Known as the place \"Where Neighbors Meet,\" ACME is a true Fort Wayne institution where families celebrate, friends catch up, and the community comes together.",
    brandVoice:
      "Down-to-earth, community-focused, warm and welcoming. Nostalgic yet fresh. Proud of heritage and tradition but not stuffy. Uses familiar, neighborly language. Tagline: \"Where Neighbors Meet — A Family Tradition Since 1941.\"",
    targetAudience:
      "Fort Wayne north side families, local regulars, casual diners, BBQ and comfort food enthusiasts, game-day crowds, and community gatherings.",
    brandColors: ["#1A1A1A", "#C41E3A", "#D4A843"],
    socialHandles: {
      facebook: "profile.php?id=61584829539727",
    },
    servicesSubscribed: [],
    contractStart: null,
    contractEnd: null,
    monthlyRetainer: null,
    status: "prospect",
    notes: [
      "Address: 1105 E State Blvd, Fort Wayne, IN 46805",
      "Phone: (260) 480-2263 (260-480-ACME)",
      "Hours: Mon 11am-9pm | Tue CLOSED | Wed-Thu 11am-9pm | Fri-Sat 11am-10pm | Sun 11am-9pm",
      "Rating: ~3.9/5 stars",
      "",
      "OWNERSHIP: Currently under Salvatori's Hospitality Group — same ownership as Salvatori's Italian Eatery, Shorty's Steakhouse, Powers Hamburgers, El Azteca, Paula's on Main, and East State Village Tap.",
      "",
      "HISTORY: Established 1941. Three generations of family ownership. Survived recessions and pandemic closures. Previously operated briefly as \"ACME by Full Circle\" (2022) under different owners before Salvatori's Hospitality Group took stewardship. Original memorabilia and nostalgia preserved.",
      "",
      "MENU HIGHLIGHTS: Legendary breaded tenderloins, 8 ACME Smoked Wings ($14), Hog Wings/small pork shanks ($14), baby back ribs, brisket, pulled pork, pizza (10\"/12\"/14\"/16\" — thin, regular, or GF crust), tacos, nachos, sandwiches/hoagies, shareable platters. Known for BBQ and Midwestern comfort food.",
      "",
      "DELIVERY: Available on Grubhub, Uber Eats.",
      "PARKING: On-site customer parking available.",
      "",
      "CROSS-SELL OPPORTUNITY: Already manage social media for Salvatori's Italian Eatery (same hospitality group). Strong upsell potential for bundled restaurant group social media management.",
    ].join("\n"),
    metadata: null,
  };

  await updateDoc(doc(db, "accounts", accountId), updatedData);
  console.log("  ✓ Account details updated with researched data");

  // ─── Delete existing contacts for this account, then add fresh ones ─
  const existingContacts = await getDocs(
    query(collection(db, "contacts"), where("accountId", "==", accountId))
  );
  for (const c of existingContacts.docs) {
    await deleteDoc(c.ref);
  }

  const contacts = [
    {
      accountId,
      name: "Salvatori's Hospitality Group",
      title: "Ownership / Management",
      email: null,
      phone: "(260) 480-2263",
      isPrimary: true,
      notes:
        "Parent hospitality group operating 11+ restaurants with 450+ employees across NE Indiana. Also manages Salvatori's Italian, Shorty's Steakhouse, Powers Hamburgers, El Azteca, Paula's on Main, East State Village Tap.",
      avatar: null,
      createdAt: serverTimestamp(),
    },
  ];

  for (const contact of contacts) {
    await addDoc(collection(db, "contacts"), contact);
    console.log(`  ✓ Contact: ${contact.name} (${contact.title})`);
  }

  // ─── Menu Items ─────────────────────────────────────────────
  const existingMenuItems = await getDocs(
    query(collection(db, "menu_items"), where("accountId", "==", accountId))
  );
  for (const m of existingMenuItems.docs) {
    await deleteDoc(m.ref);
  }

  const menuItems = [
    // Appetizers
    { name: "ACME Smoked Wings (8pc)", description: "House-smoked wings with your choice of sauce", price: "$14.00", category: "Appetizers", available: true },
    { name: "Hog Wings", description: "Small pork shanks, smoked and sauced", price: "$14.00", category: "Appetizers", available: true },
    { name: "Chips & Guacamole", description: "Fresh tortilla chips with house-made guacamole", price: "$8.00", category: "Appetizers", available: true },
    { name: "Breadsticks", description: "Warm breadsticks with dipping sauce", price: "$7.00", category: "Appetizers", available: true },
    { name: "French Fries", description: "Classic crispy fries", price: "$5.00", category: "Appetizers", available: true },
    { name: "ACME Sampler", description: "Shareable platter of house favorites", price: "$17.25", category: "Appetizers", available: true },
    { name: "Beer Queso & Chips", description: "Warm beer cheese dip with tortilla chips", price: "$10.39", category: "Appetizers", available: true },
    { name: "Nachos", description: "Loaded nachos with all the fixings", price: null, category: "Appetizers", available: true },

    // Entrees / BBQ
    { name: "Legendary Breaded Tenderloin", description: "ACME's signature hand-breaded pork tenderloin — a Midwestern classic", price: null, category: "Entrees", available: true },
    { name: "Baby Back Ribs", description: "Slow-smoked baby back ribs with BBQ glaze", price: null, category: "Entrees", available: true },
    { name: "Smoked Brisket", description: "Low-and-slow smoked beef brisket", price: null, category: "Entrees", available: true },
    { name: "Pulled Pork", description: "House-smoked pulled pork", price: null, category: "Entrees", available: true },

    // Pizza
    { name: "Pizza (10\")", description: "Build your own — thin, regular, or gluten-free crust", price: null, category: "Pizza", available: true },
    { name: "Pizza (12\")", description: "Build your own — thin, regular, or gluten-free crust", price: null, category: "Pizza", available: true },
    { name: "Pizza (14\")", description: "Build your own — thin, regular, or gluten-free crust", price: null, category: "Pizza", available: true },
    { name: "Pizza (16\")", description: "Build your own — thin, regular, or gluten-free crust", price: null, category: "Pizza", available: true },

    // Sandwiches
    { name: "Hoagies / Sandwiches", description: "Selection of deli-style hoagies and hot sandwiches", price: null, category: "Entrees", available: true },
    { name: "Tacos", description: "ACME-style tacos", price: null, category: "Entrees", available: true },
  ];

  for (const item of menuItems) {
    await addDoc(collection(db, "menu_items"), {
      ...item,
      accountId,
      image: null,
      createdAt: serverTimestamp(),
    });
  }
  console.log(`  ✓ ${menuItems.length} menu items added`);

  console.log("\n✅ ACME Bar & Grill fully updated in the CRM!");
  process.exit(0);
}

updateAcmeBarGrill().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
