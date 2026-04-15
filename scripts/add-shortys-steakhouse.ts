import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  addDoc,
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

async function addShortys() {
  console.log("Adding Shorty's Steakhouse to Firestore...\n");

  // ─── Account ────────────────────────────────────────────
  const accountData = {
    name: "Shorty's Steakhouse",
    company: "Shorty's Steakhouse",
    email: null,
    avatar: null,
    logo: "https://img1.wsimg.com/isteam/ip/f67fff9e-6b4b-49a9-acbd-e7953804c346/shortys%20logo%202.png",
    platform: "Facebook",
    industry: "Restaurant & Food Service",
    website: "https://shortyssteakhouse.com",
    accountType: "Restaurant",
    description:
      "Fine-dining steakhouse in small-town Garrett, Indiana, specializing in premium chargrilled steaks, seafood, and craft cocktails. Ranked #1 restaurant in Garrett on TripAdvisor. Featured on three Indiana Foodways Alliance culinary trails (A Cut Above Trail, Between The Buns Burger Trail, Here Fishy Fishy Trail). The bar inside is from the 1893 World's Fair. Train-themed decor honoring Garrett's railroad heritage. Named after head chef Lisa's nickname \"Shorty.\" Expanded in 2019 with side dining room and outdoor patio. Sister restaurant to Salvatori's Italian, El Azteca, Paula's on Main, and East State Village Tap. Located at 127 N Randolph St, Garrett, IN 46738.",
    brandVoice:
      "Upscale yet approachable. Small-town warmth meets fine dining sophistication. Community-rooted with pride in quality and heritage.",
    targetAudience:
      "Diners from Garrett, Fort Wayne, Auburn, Kendallville, Angola, and surrounding NE Indiana seeking premium steakhouse dining",
    brandColors: ["#1A1A1A", "#8B0000", "#D4A843"],
    socialHandles: {
      instagram: "@shortys_steakhouse",
      facebook: "shortyssteakhouse",
    },
    servicesSubscribed: [],
    contractStart: null,
    contractEnd: null,
    monthlyRetainer: null,
    status: "active",
    notes:
      "Phone: (260) 357-5665. Hours: Mon-Sat 4pm-9pm, Closed Sunday. Owner: Tim Presley. Executive Head Chef: James Morrow (10+ years). Won \"Best Restaurant in DeKalb County\" (Pioneer Eats Here). Reservations via OpenTable. Delivery via Uber Eats & Postmates. Gift cards available on website. Private parties accommodated. Menu highlights: chargrilled ribeye, NY strip, jumbo lump crab cakes, smoked Gouda crab cakes, pan-roasted Corvina, Black and Bleu Burger, peanut butter pie.",
    metadata: null,
    createdAt: serverTimestamp(),
  };

  const accountRef = await addDoc(collection(db, "accounts"), accountData);
  console.log(`  ✓ Account created: Shorty's Steakhouse → ${accountRef.id}`);

  // ─── Contacts ───────────────────────────────────────────
  const contacts = [
    {
      accountId: accountRef.id,
      name: "Tim Presley",
      title: "Owner",
      email: null,
      phone: "(260) 357-5665",
      isPrimary: true,
      notes: "Principal owner per BBB (file opened Nov 2009). Also owns Salvatori's Italian, El Azteca, Paula's on Main, East State Village Tap.",
      avatar: null,
      createdAt: serverTimestamp(),
    },
    {
      accountId: accountRef.id,
      name: "James Morrow",
      title: "Executive Head Chef",
      email: null,
      phone: null,
      isPrimary: false,
      notes: "Has created and curated the menu over 10+ years. Balances fine steakhouse dining with small-town Indiana fare.",
      avatar: null,
      createdAt: serverTimestamp(),
    },
  ];

  for (const contact of contacts) {
    await addDoc(collection(db, "contacts"), contact);
    console.log(`  ✓ Contact created: ${contact.name} (${contact.title})`);
  }

  console.log("\nDone! Shorty's Steakhouse is now in the CRM.");
  process.exit(0);
}

addShortys().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
