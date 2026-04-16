import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import { firebaseConfig } from "./firebase-config";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function addPowersHamburgers() {
  console.log("Adding Powers Hamburgers to Firestore...\n");

  // ─── Account ────────────────────────────────────────────
  const accountData = {
    name: "Powers Hamburgers",
    company: "Powers Hamburgers",
    email: null,
    avatar: null,
    logo: "https://powershamburgers.com/assets/images/about/POWERS%20HAMBURGERS%20LOGO.png",
    platform: "Instagram",
    industry: "Restaurant & Food Service",
    website: "https://powershamburgers.com",
    accountType: "Restaurant",
    description:
      "Iconic Fort Wayne, Indiana slider diner est. 1940. Famous for thin beef patties cooked with hand-sliced onions on steamed buns using Leo Powers' original recipe. Officially proclaimed the \"Slider Capital of the World\" by the Indiana Governor and Fort Wayne Mayor. Named one of the top 5 places in the country for a classic hamburger by George Motz (Hamburger America). Currently owned by Alex Richardson and Salvatori's Hospitality Group (Panos & Stephanie Bourounis). Single location at 1402 S Harrison St, Fort Wayne, IN 46802.",
    brandVoice:
      "Classic Americana, nostalgic, community-focused, proud heritage. Down-to-earth, approachable tone celebrating tradition and quality.",
    targetAudience:
      "Local Fort Wayne community, burger enthusiasts, foodies, tourists, families",
    brandColors: ["#C41E3A", "#FFD700", "#1A1A1A"],
    socialHandles: {
      instagram: "@powershamburgers",
      facebook: "PowersHamburgers",
    },
    servicesSubscribed: [],
    contractStart: null,
    contractEnd: null,
    monthlyRetainer: null,
    status: "prospect",
    notes:
      "Phone: (260) 422-6620. Hours: Mon-Wed 10am-10pm, Thu-Sat 10am-12am, Closed Sunday. 20-seat diner. Survived 2024 fire, reopened Oct 2024 after major renovation. Menu: sliders, coney dogs, homemade chili, fries, malts, root beer floats. Fresh beef from Didier Meats, buns from Aunt Millie's. Online ordering via SkyTab, DoorDash, Uber Eats. Catering via SRGCatering.com.",
    metadata: null,
    createdAt: serverTimestamp(),
  };

  const accountRef = await addDoc(collection(db, "accounts"), accountData);
  console.log(`  ✓ Account created: Powers Hamburgers → ${accountRef.id}`);

  // ─── Contact ────────────────────────────────────────────
  const contactData = {
    accountId: accountRef.id,
    name: "Alex Richardson",
    title: "Managing Partner",
    email: null,
    phone: "(260) 422-6620",
    isPrimary: true,
    notes:
      "Managing partner since April 2024. Runs day-to-day operations under Salvatori's Hospitality Group.",
    avatar: null,
    createdAt: serverTimestamp(),
  };

  await addDoc(collection(db, "contacts"), contactData);
  console.log("  ✓ Contact created: Alex Richardson (Managing Partner)");

  console.log("\nDone! Powers Hamburgers is now in the CRM.");
  process.exit(0);
}

addPowersHamburgers().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
