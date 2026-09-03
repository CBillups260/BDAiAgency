import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";

import { firebaseConfig } from "./firebase-config";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function run() {
  console.log("Updating Paula's On Main with brand info, contacts, and full dinner menu…\n");

  const q = query(collection(db, "accounts"), where("company", "==", "Paula's On Main"));
  const snap = await getDocs(q);
  if (snap.empty) {
    console.error("Account 'Paula's On Main' not found in Firestore.");
    process.exit(1);
  }

  const accountRef = snap.docs[0].ref;
  const accountId = accountRef.id;
  console.log(`  Found account → ${accountId}`);

  // ─── Update brand-level info (preserves logos, avatar, etc.) ─────────
  await updateDoc(accountRef, {
    name: "Paula's On Main",
    industry: "Seafood Restaurant",
    accountType: "Restaurant",
    status: "active",
    email: "paulasfortwayne@gmail.com",
    website: "https://www.paulasonmain.com",
    description:
      "Fort Wayne neighborhood seafood institution on West Main Street with 30+ years of consistent quality. " +
      "Full-service restaurant plus an attached fresh seafood market (open noon–9pm daily except Sunday). " +
      "Known for chargrilled and shucked oysters, jumbo shrimp, almond walleye, Maryland crab cakes, " +
      "Alaskan king crab legs, Chilean sea bass, and Beverly Bryant's house-baked Key Lime Pie and banana cream pie. " +
      "Country-cottage interior with nautical accents. Sister restaurant to Shorty's Steakhouse, Salvatori's, " +
      "El Azteca, and East State Village Tap (all under owner Tim Presley).",
    brandVoice:
      "Warm, family-rooted, and proud. Old-school Midwest hospitality meets serious seafood expertise. " +
      "Confident in quality and freshness without being stuffy — the longtime neighborhood favorite that's stayed loyal to its craft.",
    targetAudience:
      "Fort Wayne and northeast Indiana diners seeking fresh seafood, special-occasion dinners, and a warm neighborhood feel. " +
      "Families, couples, and seafood enthusiasts who'll drive in from Auburn, Garrett, Angola, and beyond.",
    brandColors: ["#7B1F2D", "#F5EBD7", "#1A1A1A"],
    socialHandles: {
      facebook: "https://www.facebook.com/profile.php?id=61562805330190",
    },
    notes:
      "Address: 1732 West Main St, Fort Wayne, IN 46808. Phone: (260) 424-2300. Reservations via Toast " +
      "(https://tables.toasttab.com/restaurants/f590e167-4a39-477d-a076-7da0d150d82a/reserve). " +
      "Seafood market attached to restaurant, open noon–9pm every day except Sunday. " +
      "Managing Partner: Joseph Sirk (20+ years restaurant management). " +
      "Executive Chef: Brittany Shroyer. Pastry Chef: Beverly Bryant (since July 2019; famous Key Lime Pie). " +
      "Signature items called out by reviewers: King Crab Legs, Key Lime Pie, banana cream pie, mahi mahi. " +
      "Sister restaurants under Tim Presley: Shorty's Steakhouse, Salvatori's, El Azteca, East State Village Tap.",
  });
  console.log("  ✓ Brand fields updated (logos and avatar preserved)");

  // ─── Replace existing contacts for idempotency ───────────────────────
  const existingContacts = await getDocs(
    query(collection(db, "contacts"), where("accountId", "==", accountId)),
  );
  for (const d of existingContacts.docs) await deleteDoc(d.ref);
  if (existingContacts.size) console.log(`  Cleared ${existingContacts.size} old contacts`);

  const contacts = [
    {
      accountId,
      name: "Joseph Sirk",
      title: "Managing Partner",
      email: "paulasfortwayne@gmail.com",
      phone: "(260) 424-2300",
      isPrimary: true,
      notes:
        "Joe has been part of the Fort Wayne restaurant scene for many years; 20+ years of management experience. " +
        "Primary point of contact for the restaurant.",
      avatar: null,
      createdAt: serverTimestamp(),
    },
    {
      accountId,
      name: "Brittany Shroyer",
      title: "Executive Chef",
      email: null,
      phone: null,
      isPrimary: false,
      notes: "Runs the kitchen; sets the seafood menu direction.",
      avatar: null,
      createdAt: serverTimestamp(),
    },
    {
      accountId,
      name: "Beverly Bryant",
      title: "Pastry Chef / Baker",
      email: null,
      phone: null,
      isPrimary: false,
      notes:
        "Baker since July 2019. Makes Paula's bread daily and the Fort Wayne-famous Key Lime Pie. " +
        "Also creates signature desserts that staff can suggest to diners (banana cream pie called out by reviewers).",
      avatar: null,
      createdAt: serverTimestamp(),
    },
  ];
  for (const c of contacts) {
    await addDoc(collection(db, "contacts"), c);
    console.log(`  ✓ Contact: ${c.name} (${c.title})`);
  }

  // ─── Clear and replace menu items ────────────────────────────────────
  const existingMenu = await getDocs(
    query(collection(db, "menu_items"), where("accountId", "==", accountId)),
  );
  for (const d of existingMenu.docs) await deleteDoc(d.ref);
  if (existingMenu.size) console.log(`  Cleared ${existingMenu.size} old menu items`);

  const menuItems: { name: string; description: string; price: string; category: string }[] = [
    // ── Appetizers (11) ───────────────────────────────────────────────
    { name: "Mussels", description: "Coconut cream with Thai basil and chilis, served with grilled flat bread.", price: "$18", category: "Appetizers" },
    { name: "Almond Walleye Planks", description: "Almond walleye, jalapeño tartar.", price: "$19", category: "Appetizers" },
    { name: "Char-Grilled Oysters", description: "Garlic butter, spinach, parmesan cheese. (GF)", price: "$20", category: "Appetizers" },
    { name: "Fresh Shucked Oysters", description: "Choose preparation: fried or on the half shell.", price: "$18", category: "Appetizers" },
    { name: "Crab Cake", description: "Loaded with crab, served with jalapeño tartar.", price: "$24", category: "Appetizers" },
    { name: "Jumbo Shrimp Cocktail", description: "Zesty cocktail sauce, fresh lemon. (GF)", price: "$21", category: "Appetizers" },
    { name: "Buffalo Shrimp", description: "Blue cheese crumbles, ranch dressing.", price: "$21", category: "Appetizers" },
    { name: "Crispy Calamari", description: "Lemon aioli, marinara sauce.", price: "$18", category: "Appetizers" },
    { name: "Tuna Sashimi", description: "Soy sauce, ginger, wasabi, asian slaw. (GF)", price: "$26", category: "Appetizers" },
    { name: "Filet Crostinis", description: "Filet tips, crostinis, caramelized onions, balsamic glaze, boursin cheese spread.", price: "$18", category: "Appetizers" },
    { name: "New England Clam Chowder", description: "Our signature housemade chowder.", price: "$7", category: "Appetizers" },

    // ── Salads (5) ────────────────────────────────────────────────────
    { name: "House Salad", description: "Blue cheese crumbles, tomatoes, cucumbers, candied pecans, balsamic vinaigrette. (GF)", price: "$10", category: "Salads" },
    { name: "Wedge", description: "Bacon, blue cheese crumbles, tomatoes, ranch. (GF)", price: "$11", category: "Salads" },
    { name: "Caesar", description: "Croutons, parmesan.", price: "$10", category: "Salads" },
    { name: "Salmon Salad", description: "Roasted salmon with basil pesto on mixed greens, cucumbers, tomatoes, feta cheese, toasted almonds, and roasted red pepper vinaigrette.", price: "$34", category: "Salads" },
    { name: "Surf and Turf Salad", description: "Filet tips, grilled shrimp, mixed greens, tomatoes, blue cheese crumbles, crispy onions, balsamic vinaigrette.", price: "$32", category: "Salads" },

    // ── Entrees (22): Lighter Side + full Entrée menu ─────────────────
    { name: "Fish Tacos", description: "Blackened cod, soft corn tortilla, avocado, pickled jalapeño, pico de gallo, queso fresco, house salsa, and chipotle sour cream.", price: "2 for $15 / 3 for $19", category: "Entrees" },
    { name: "Classic Fish Sandwich", description: "Panko crusted, lettuce, onion, pickle, slaw, fries, and Cape Cod tartar.", price: "$25", category: "Entrees" },
    { name: "Fish 'N' Chips", description: "Beer battered cod, fries, slaw, jalapeño tartar, malt vinegar.", price: "$29", category: "Entrees" },
    { name: "Almond Walleye", description: "Almond-herb crusted Canadian walleye, jalapeño tartar. Served with choice of House, Caesar, or Wedge and choice of side.", price: "$37", category: "Entrees" },
    { name: "Combo Platter", description: "Maryland crab cake, almond walleye plank, grilled scallops, jalapeño tartar. Served with choice of House, Caesar, or Wedge and choice of side.", price: "$49", category: "Entrees" },
    { name: "Chilean Sea Bass", description: "Roasted, scallion ginger butter, rice noodle salad, topped with crushed peanuts, tempura lobster, teriyaki glaze. Served with salad only. (GF)", price: "$64", category: "Entrees" },
    { name: "Maryland Crab Cakes", description: "Lightly seasoned, loaded with crab. Served with choice of House, Caesar, or Wedge and choice of side.", price: "$38 (1 cake) / $58 (2 cakes)", category: "Entrees" },
    { name: "Alaskan King Crab Legs", description: "Drawn butter, lemon. Available in 0.75 LB, 1.5 LB, or 2.25 LB. Served with choice of House, Caesar, or Wedge and choice of side. (GF)", price: "Market Price", category: "Entrees" },
    { name: "Lobster Tail", description: "Drawn butter, lemon. Served with choice of House, Caesar, or Wedge and choice of side. (GF)", price: "Market Price", category: "Entrees" },
    { name: "Jambalaya", description: "Shrimp, andouille sausage, chicken, seasoned rice, crab garnish. Served with salad only. (GF)", price: "$38", category: "Entrees" },
    { name: "Plate O'Perch", description: "Thin and crispy seasoned breading, Cape Cod tartar. Served with choice of House, Caesar, or Wedge and choice of side.", price: "$46", category: "Entrees" },
    { name: "Perch Piccata", description: "Lemon, caper butter. Served with choice of House, Caesar, or Wedge and choice of side.", price: "$46", category: "Entrees" },
    { name: "Blackened Swordfish", description: "Horseradish sauce, crispy shallots, mashed potatoes. Served with salad only.", price: "$39", category: "Entrees" },
    { name: "Tuna", description: "Sesame crusted tuna, soy sauce, ginger, wasabi, asian slaw, rice. Served with salad only. (GF)", price: "$57", category: "Entrees" },
    { name: "Thai Grouper", description: "Sesame crusted, Thai drizzle, cucumber slaw, jasmine rice. Served with salad only.", price: "$55", category: "Entrees" },
    { name: "Shrimp Combo", description: "3 almond shrimp, 3 coconut shrimp, 2 sauces. Served with choice of House, Caesar, or Wedge and choice of side.", price: "$36", category: "Entrees" },
    { name: "Scallops", description: "Seasoned, grilled, sweet corn puree, topped with pepper relish, potato threads, scallion vinaigrette. Served with salad only. (GF)", price: "$59", category: "Entrees" },
    { name: "Teriyaki Salmon", description: "Teriyaki glazed, asian slaw, jasmine rice. Served with salad only.", price: "$39", category: "Entrees" },
    { name: "Blackened Salmon", description: "Blue cheese glaze, mashed potatoes. Served with salad only. (GF)", price: "$39", category: "Entrees" },
    { name: "Rustic Chicken", description: "Marinated chicken, roasted pepper aioli, rustic potatoes, brussel sprouts. Served with salad only.", price: "$36", category: "Entrees" },
    { name: "Filet Mignon", description: "8oz filet, mashed potatoes, demi glace, grilled asparagus. Served with salad only.", price: "$61", category: "Entrees" },
    { name: "Surf & Turf", description: "16oz Cowboy ribeye over risotto and scampi sauce, topped with lobster. Served with salad only. (GF)", price: "$72", category: "Entrees" },
  ];

  for (const item of menuItems) {
    await addDoc(collection(db, "menu_items"), {
      ...item,
      accountId,
      image: null,
      available: true,
      createdAt: serverTimestamp(),
    });
    console.log(`  ✓ ${item.category}: ${item.name} — ${item.price}`);
  }

  console.log(`\nDone. ${menuItems.length} menu items and ${contacts.length} contacts added for Paula's On Main.`);
  process.exit(0);
}

run().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
