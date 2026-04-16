import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  addDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";
import { firebaseConfig } from "./firebase-config";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function addBillsTowingServices() {
  console.log("Adding services for Bill's Professional Towing & Repair...\n");

  // Find account
  const q = query(
    collection(db, "accounts"),
    where("company", "==", "Bill's Professional Towing & Repair")
  );
  const snap = await getDocs(q);
  if (snap.empty) {
    console.error("Account not found!");
    process.exit(1);
  }

  const accountId = snap.docs[0].id;
  console.log(`  Found account → ${accountId}`);

  // Clear existing menu_items for this account
  const existing = await getDocs(
    query(collection(db, "menu_items"), where("accountId", "==", accountId))
  );
  for (const d of existing.docs) await deleteDoc(d.ref);
  if (existing.size) console.log(`  Cleared ${existing.size} existing items`);

  const services = [
    // Core Services
    { name: "Local Towing", description: "Light and medium-duty towing for cars, trucks, and SUVs across Angola, Fremont, and surrounding NE Indiana", price: null, category: "Core Services", available: true },
    { name: "Long-Distance Towing", description: "Reliable vehicle transport across Indiana, Michigan, and beyond", price: null, category: "Core Services", available: true },
    { name: "Heavy-Duty Towing", description: "Towing for large trucks, commercial vehicles, and heavy equipment", price: null, category: "Core Services", available: true },
    { name: "Semi Towing", description: "Full semi-truck and tractor-trailer towing and recovery", price: null, category: "Core Services", available: true },
    { name: "Accident Recovery", description: "On-scene accident recovery including vehicle extraction, debris cleanup, and load transfers", price: null, category: "Core Services", available: true },
    { name: "Vehicle & Equipment Recovery", description: "Recovery of vehicles and heavy equipment from ditches, embankments, mud, and off-road situations", price: null, category: "Core Services", available: true },

    // Emergency Services
    { name: "24/7 Emergency Roadside Assistance", description: "Round-the-clock emergency response for breakdowns anywhere in NE Indiana and Southern Michigan", price: null, category: "Emergency Services", available: true },
    { name: "Battery Boost / Jumpstart", description: "On-site battery boost and jumpstart service to get you moving again", price: null, category: "Emergency Services", available: true },
    { name: "Fuel Delivery", description: "Emergency fuel delivery when you run out on the road", price: null, category: "Emergency Services", available: true },
    { name: "Lockout Service", description: "Professional vehicle lockout assistance — get back into your car safely", price: null, category: "Emergency Services", available: true },
    { name: "Flat Tire Change", description: "Roadside tire change with your spare or transport to nearest tire shop", price: null, category: "Emergency Services", available: true },
    { name: "Emergency Breakdown Repair", description: "Minor on-site repairs to get your vehicle drivable and off the roadside", price: null, category: "Emergency Services", available: true },

    // Maintenance & Repair
    { name: "Brake Service & Repair", description: "Full brake inspection, pad/rotor replacement, and brake system repair", price: null, category: "Maintenance", available: true },
    { name: "Tune-Ups", description: "Engine tune-ups including spark plugs, filters, fluids, and diagnostics", price: null, category: "Maintenance", available: true },
    { name: "Engine Overhaul", description: "Complete engine rebuild and overhaul services for cars and trucks", price: null, category: "Maintenance", available: true },
    { name: "General Auto Repair", description: "Full-service auto repair by ASE Certified Technicians — NAPA AutoCare Center", price: null, category: "Maintenance", available: true },
    { name: "Heavy Truck Repair", description: "On-site and in-shop repair for heavy trucks and commercial vehicles — NAPA Truck Center", price: null, category: "Maintenance", available: true },

    // Fleet Services
    { name: "Fleet Maintenance Programs", description: "Scheduled maintenance and repair programs for commercial fleets of all sizes", price: null, category: "Fleet Services", available: true },
    { name: "Fleet Towing & Recovery", description: "Priority towing and recovery services for fleet vehicles with dedicated response", price: null, category: "Fleet Services", available: true },

    // Specialty
    { name: "Classic Car Transport", description: "Careful transport and handling of classic, vintage, and collector vehicles", price: null, category: "Specialty", available: true },
    { name: "Classic Car Maintenance", description: "Specialized maintenance and repair for classic and vintage automobiles", price: null, category: "Specialty", available: true },
    { name: "Load Transfer & Storage", description: "Cargo load transfer from disabled vehicles and secure storage facilities", price: null, category: "Specialty", available: true },
  ];

  for (const svc of services) {
    await addDoc(collection(db, "menu_items"), {
      ...svc,
      accountId,
      image: null,
      createdAt: serverTimestamp(),
    });
  }

  console.log(`  ✓ ${services.length} services added to Bill's Professional Towing & Repair`);
  console.log("\nDone!");
  process.exit(0);
}

addBillsTowingServices().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
