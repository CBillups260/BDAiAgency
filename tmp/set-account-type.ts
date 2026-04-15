import { initializeApp } from "firebase/app";
import { getFirestore, collection, query, where, getDocs, updateDoc } from "firebase/firestore";

const app = initializeApp({
  apiKey: "AIzaSyAkvNPMQ5UPnUcmXXfR9bRxGGRsxKarvr0",
  authDomain: "ai-designer-b3ea6.firebaseapp.com",
  projectId: "ai-designer-b3ea6",
  storageBucket: "ai-designer-b3ea6.firebasestorage.app",
  messagingSenderId: "309126109469",
  appId: "1:309126109469:web:781b7beaaf4900bcf1e9f4",
});

async function run() {
  const db = getFirestore(app);
  const q = query(collection(db, "accounts"), where("company", "==", "Salvatori's Italian Eatery"));
  const snap = await getDocs(q);
  for (const d of snap.docs) {
    await updateDoc(d.ref, { accountType: "Restaurant" });
    console.log("✓ Set accountType to Restaurant for", d.data().company);
  }
  process.exit(0);
}

run();
