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

async function updateVillageTap() {
  console.log("Updating The Village Tap in Firestore...\n");

  const accountsRef = collection(db, "accounts");

  const variants = [
    "The Village Tap",
    "Village Tap",
    "Village Tap House",
    "East State Village Tap",
    "the village tap",
    "village tap",
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
      name: "The Village Tap",
      company: "The Village Tap",
      createdAt: serverTimestamp(),
    });
    accountId = newRef.id;
    console.log(`  ✓ Created account stub → ${accountId}`);
  }

  // ─── Update with researched details ────────────────────────
  const updatedData = {
    name: "The Village Tap",
    company: "The Village Tap",
    email: null,
    avatar: null,
    logo: null,
    platform: "Facebook",
    industry: "Restaurant & Food Service",
    website: "https://www.eaststatevillagetap.com",
    accountType: "Restaurant",
    description:
      "Fort Wayne's premier neighborhood tavern in the '05 East State Village neighborhood, est. 2015. Owned and operated by three brothers — Matt, Kurt, and Chris Henry — who took over the legendary Nick's Rib Room location from Sam Filippou (nephew of original owner Nick Stamanis). Known for Nick's famous slow-cooked BBQ ribs recipe, hand-breaded pork tenderloin, premium half-pound burgers, Cuban sandwiches, and a full craft beer selection with 16 rotating taps. Also operates \"Nick's in the East State Village\" next door — an upscale sibling restaurant sharing the same kitchen, offering elevated American classics with live music Thu–Sat. Rated 4.6–4.7/5 stars across platforms.",
    brandVoice:
      "Friendly, neighborhood-proud, and down-to-earth. Casual tavern warmth with genuine hospitality. Community-driven — \"Good food and good people will always help build a stronger, safer, and kinder community.\"",
    targetAudience:
      "Fort Wayne '05 neighborhood residents, casual diners, craft beer enthusiasts, families, BBQ lovers, and anyone looking for a welcoming neighborhood hangout with great food and cold beer.",
    brandColors: ["#1A1A1A", "#B8860B", "#FFFFFF"],
    socialHandles: {
      facebook: "fwvillagetap",
    },
    servicesSubscribed: [],
    contractStart: null,
    contractEnd: null,
    monthlyRetainer: null,
    status: "prospect",
    notes: [
      "ADDRESS: 1235 E State Blvd, Fort Wayne, IN 46805",
      "PHONE: (260) 471-1117",
      "WEBSITE: eaststatevillagetap.com",
      "ONLINE ORDERING: order.toasttab.com (Toast POS)",
      "HOURS: Mon-Thu 3pm-10pm | Fri-Sat 3pm-11pm | Sun CLOSED",
      "",
      "RATING: 4.6-4.7/5 stars (141+ reviews across Google & Facebook)",
      "",
      "OWNERSHIP: Matt, Kurt, and Chris Henry (three brothers). Purchased in 2015 from Sam Filippou, nephew of Nick Stamanis (original Nick's Rib Room owner).",
      "",
      "SISTER RESTAURANT: \"Nick's in the East State Village\" — upscale sibling next door sharing the same kitchen. Elevated American classics, signature ribs, live music Thu-Sat. Website: nickseaststatevillage.com",
      "",
      "HISTORY: Location was formerly Nick's Rib Room, a beloved Fort Wayne institution known for award-winning ribs. The Henry brothers preserved Nick's famous rib recipe and built a neighborhood tavern around it.",
      "",
      "KEY MENU ITEMS: Slow-cooked BBQ ribs (Nick's legacy recipe), hand-breaded pork tenderloin, premium 1/2 lb burgers, Cuban sandwich, Tap Burger (beef+chorizo+ham), smoked brisket, pulled pork, wings (6 sauce options), Bavarian pretzel, 05 Drunken Nachos, fish & chips.",
      "",
      "BEER: 16 rotating taps — domestic, imported, microbrew, regional, and local craft. Full-service bar.",
      "",
      "DELIVERY: Waiter on the Way, DoorDash, Toast online ordering.",
      "",
      "MARKETING OPPORTUNITY: Strong local reputation and loyal following. Facebook presence but no Instagram. Great candidate for social media content (food photography, beer features, rib specials, community events). Bundled opportunity with sister restaurant Nick's.",
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
      name: "Matt Henry",
      title: "Co-Owner",
      email: null,
      phone: "(260) 471-1117",
      isPrimary: true,
      notes: "One of three Henry brothers who own and operate The Village Tap and Nick's in the East State Village.",
      avatar: null,
      createdAt: serverTimestamp(),
    },
    {
      accountId,
      name: "Kurt Henry",
      title: "Co-Owner",
      email: null,
      phone: "(260) 471-1117",
      isPrimary: false,
      notes: "Co-owner, Henry brothers.",
      avatar: null,
      createdAt: serverTimestamp(),
    },
    {
      accountId,
      name: "Chris Henry",
      title: "Co-Owner",
      email: null,
      phone: "(260) 471-1117",
      isPrimary: false,
      notes: "Co-owner, Henry brothers.",
      avatar: null,
      createdAt: serverTimestamp(),
    },
  ];

  for (const contact of contacts) {
    await addDoc(collection(db, "contacts"), contact);
    console.log(`  ✓ Contact: ${contact.name} (${contact.title})`);
  }

  // ─── Menu Items ─────────────────────────────────────────────
  const existingItems = await getDocs(
    query(collection(db, "menu_items"), where("accountId", "==", accountId))
  );
  for (const d of existingItems.docs) await deleteDoc(d.ref);

  const menuItems = [
    // Appetizers
    { name: "Tap House Empanada", description: "Chef's choice protein, bell pepper, onion, shredded cheese, lettuce, sour cream, salsa", price: "$16.19", category: "Appetizers", available: true },
    { name: "Village Tap Wings (8pc)", description: "Choice of sauce (Buffalo, Asian Zing, Sriracha Maple, Garlic Parm, BBQ, Oscar's Dry Rub, Naked) + celery", price: "$16.19", category: "Appetizers", available: true },
    { name: "Bavarian Pretzel", description: "Soft pretzel with beer cheese and whole grain mustard dips", price: "$10.39", category: "Appetizers", available: true },
    { name: "Spicy Cheese Curds", description: "Served with ranch", price: "$9.29", category: "Appetizers", available: true },
    { name: "Onion Ring Basket", description: "Beer battered onion rings with beer cheese dip", price: "$9.29", category: "Appetizers", available: true },
    { name: "Garlic Toast Basket (5pc)", description: "Toasted garlic bread, option to add cheese", price: "$6.99", category: "Appetizers", available: true },
    { name: "05 Drunken Nacho", description: "Homemade chips, pulled pork, beer cheese, green onion", price: "$18.49", category: "Appetizers", available: true },
    { name: "Loaded Cheese Fries", description: "Fries, cheese, bacon, green onion, dipping sauce, optional protein (chicken, pork, or chorizo)", price: "$12.69", category: "Appetizers", available: true },
    { name: "Smoked Jalapeno Poppers", description: "Jalapeno stuffed with sausage, cream cheese, wrapped in bacon, served with ranch", price: "$11.59", category: "Appetizers", available: true },
    { name: "Breaded Mushrooms", description: "Breaded portobello strips with spicy thousand island and ranch", price: "$9.29", category: "Appetizers", available: true },
    { name: "Rib Tip Basket (1 lb)", description: "1 lb rib tips with house BBQ and fries", price: "$13.89", category: "Appetizers", available: true },

    // Salads
    { name: "Greek Salad", description: "Greens, beets, pineapple, tomato, olives, pepperoncini, green onion, feta, greek dressing", price: "$9.79", category: "Salads", available: true },
    { name: "House Salad", description: "Greens, tomato, green onion, cheese, croutons, choice of dressing", price: "$9.29", category: "Salads", available: true },
    { name: "Calypso Salad", description: "Greens, tomato, green onion, beets, french dressing", price: "$9.29", category: "Salads", available: true },
    { name: "Italian Salad", description: "Greens, red pepper, green onion, mozzarella, croutons, italian dressing", price: "$8.09", category: "Salads", available: true },

    // Dinners & BBQ
    { name: "Half Slab Ribs", description: "6 rib bones (Nick's famous recipe) with fries and garlic toast. Regular or spicy BBQ", price: "$21.89", category: "Entrees", available: true },
    { name: "Full Slab Ribs", description: "12 rib bones (Nick's famous recipe) with double fries and 2pc garlic toast. Regular or spicy BBQ", price: "$36.89", category: "Entrees", available: true },
    { name: "Brisket", description: "Smoked brisket (1/4, 1/2, or 1 lb) with BBQ, fries, and garlic toast", price: "$13.89", category: "Entrees", available: true },
    { name: "Pulled Pork Dinner", description: "Smoked pulled pork (1/4, 1/2, or 1 lb) with BBQ, fries, and garlic toast", price: "$11.59", category: "Entrees", available: true },
    { name: "BBQ Chicken & Rib Dinner", description: "1/4 roast chicken + 3 rib bones with fries and garlic toast", price: "$21.89", category: "Entrees", available: true },
    { name: "BBQ Chicken Dinner", description: "1/4 BBQ chicken with fries and garlic toast", price: "$18.39", category: "Entrees", available: true },
    { name: "East State Quesadillas", description: "Pulled pork, bell peppers, onion, shredded cheese, BBQ", price: "$14.99", category: "Entrees", available: true },
    { name: "Fish & Chips", description: "Fried Alaskan pollock with fries and tartar sauce (jalapeno or traditional)", price: "$18.49", category: "Entrees", available: true },
    { name: "Chicken Strips Dinner", description: "Chicken tenders with honey mustard and fries", price: "$14.99", category: "Entrees", available: true },

    // Sandwiches & Burgers
    { name: "Cuban Sandwich", description: "Shredded pork, shaved ham, swiss cheese, pickle on ciabatta + 1 side", price: "$17.29", category: "Sandwiches", available: true },
    { name: "Tap Burger", description: "Ground beef + chorizo + ham, swiss cheese, chipotle mayo, pickle + 1 side", price: "$18.49", category: "Sandwiches", available: true },
    { name: "Smoked Pulled Chicken Sandwich", description: "Pulled chicken, BBQ sauce, coleslaw, red onion, pickle + 1 side", price: "$16.19", category: "Sandwiches", available: true },
    { name: "Breaded Tenderloin Sandwich", description: "Hand-breaded or grilled pork tenderloin, mustard, onion, pickle + 1 side", price: "$16.19", category: "Sandwiches", available: true },
    { name: "Smoked Pulled Pork Sandwich", description: "Pulled pork, BBQ sauce, coleslaw, red onion, pickle + 1 side", price: "$16.19", category: "Sandwiches", available: true },
    { name: "Smoked Brisket Philly Cheese", description: "Smoked brisket, sauteed red pepper, yellow onion, beer cheese + 1 side", price: "$18.49", category: "Sandwiches", available: true },
    { name: "Crispy Chicken Sandwich", description: "Breaded chicken, lettuce, tomato, onion, pickle, thousand island + 1 side", price: "$18.49", category: "Sandwiches", available: true },
    { name: "Fish Sandwich", description: "Fried pollock, american cheese, shredded lettuce, pickle, jalapeno tartar on hoagie + 1 side", price: "$17.29", category: "Sandwiches", available: true },
    { name: "Classic Cheeseburger", description: "Premium 1/2 lb burger, lettuce, onion, pickle, choice of cheese + 1 side", price: "$17.29", category: "Sandwiches", available: true },
    { name: "Ham & Cheese Grinder", description: "Shaved ham, toasted ciabatta, mozzarella, lettuce, tomato + 1 side", price: "$16.19", category: "Sandwiches", available: true },
    { name: "Mushroom & Swiss Burger", description: "1/2 lb burger, breaded portobello mushroom, blue cheese, lettuce, tomato, onion, pickle + chips", price: "$19.59", category: "Sandwiches", available: true },

    // Sides
    { name: "House Chips", description: "Fresh-cut house chips", price: "$4.60", category: "Sides", available: true },
    { name: "Fries", description: "Classic fries", price: "$5.75", category: "Sides", available: true },
    { name: "Onion Rings (Side)", description: "Beer battered onion rings", price: "$5.75", category: "Sides", available: true },
    { name: "Mac N Cheese", description: "Creamy mac and cheese", price: "$5.75", category: "Sides", available: true },
    { name: "Cole Slaw", description: "House-made coleslaw", price: "$4.60", category: "Sides", available: true },
    { name: "Tater Tots", description: "Crispy tater tots", price: "$4.60", category: "Sides", available: true },

    // Desserts
    { name: "Homemade Brownie", description: "Rich homemade brownie", price: "$9.29", category: "Desserts", available: true },
    { name: "Homemade Bread Pudding", description: "Warm house-made bread pudding", price: "$9.29", category: "Desserts", available: true },
    { name: "Four Layer Chocolate Cake", description: "Decadent four-layer chocolate cake", price: "$9.29", category: "Desserts", available: true },
    { name: "Seasonal Cheesecake", description: "Rotating seasonal cheesecake selection", price: "$9.29", category: "Desserts", available: true },
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

  console.log("\n✅ The Village Tap fully updated in the CRM!");
  process.exit(0);
}

updateVillageTap().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
