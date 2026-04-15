import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, deleteDoc, query, where } from "firebase/firestore";

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

  const accountsSnap = await getDocs(collection(db, "accounts"));
  let kept = 0;
  let deleted = 0;

  for (const doc of accountsSnap.docs) {
    const company = doc.data().company;
    if (company === "Salvatori's Italian Eatery") {
      kept++;
      console.log(`  ✓ Kept: ${company}`);
      continue;
    }

    // Delete associated contacts first
    const contactsSnap = await getDocs(
      query(collection(db, "contacts"), where("accountId", "==", doc.id))
    );
    for (const c of contactsSnap.docs) {
      await deleteDoc(c.ref);
    }
    if (contactsSnap.size > 0) {
      console.log(`    Deleted ${contactsSnap.size} contacts for ${company}`);
    }

    await deleteDoc(doc.ref);
    deleted++;
    console.log(`  ✗ Deleted: ${company}`);
  }

  console.log(`\nDone — kept ${kept}, deleted ${deleted} mock accounts`);
  process.exit(0);
}

run();
