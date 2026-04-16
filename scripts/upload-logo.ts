import { initializeApp } from "firebase/app";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  updateDoc,
} from "firebase/firestore";
import { readFileSync } from "fs";
import { firebaseConfig } from "./firebase-config";

const app = initializeApp(firebaseConfig);
const storage = getStorage(app);
const db = getFirestore(app);

async function uploadLogo() {
  const filePath = process.argv[2];
  const companyName = process.argv[3];

  if (!filePath || !companyName) {
    console.error("Usage: tsx scripts/upload-logo.ts <file-path> <company-name>");
    process.exit(1);
  }

  const fileBuffer = readFileSync(filePath);
  const fileName = `logos/${companyName.toLowerCase().replace(/[^a-z0-9]/g, "-")}-logo.png`;

  console.log(`Uploading ${filePath} → ${fileName}...`);
  const storageRef = ref(storage, fileName);
  await uploadBytes(storageRef, fileBuffer, { contentType: "image/png" });
  const downloadURL = await getDownloadURL(storageRef);
  console.log(`  ✓ Uploaded: ${downloadURL}`);

  const accountsRef = collection(db, "accounts");
  const q = query(accountsRef, where("company", "==", companyName));
  const snap = await getDocs(q);

  if (snap.empty) {
    console.log(`  ⚠ No account found with company="${companyName}". Logo URL:`);
    console.log(`    ${downloadURL}`);
  } else {
    for (const docSnap of snap.docs) {
      await updateDoc(docSnap.ref, { logo: downloadURL, avatar: downloadURL });
      console.log(`  ✓ Updated account ${docSnap.id} (${docSnap.data().company}) with logo`);
    }
  }

  process.exit(0);
}

uploadLogo().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
