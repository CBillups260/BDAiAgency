import { initializeApp } from "firebase/app";
import { getFirestore, collection, query, where, getDocs, updateDoc } from "firebase/firestore";
import { firebaseConfig } from "../scripts/firebase-config";

const app = initializeApp(firebaseConfig);

async function run() {
  const db = getFirestore(app);
  const q = query(collection(db, "accounts"), where("company", "==", "Salvatori's Italian Eatery"));
  const snap = await getDocs(q);
  for (const d of snap.docs) {
    await updateDoc(d.ref, { brandColors: ["#008C45", "#FFFFFF", "#CD212A"] });
    console.log("✓ Updated brand colors for", d.data().company, "→ green, white, red");
  }
  process.exit(0);
}

run();
